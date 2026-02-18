import { completeUpload, createIdempotencyKey, initUpload, uploadPart } from "./api";

async function sha256HexFromBlob(blob) {
  const bytes = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((part) => part.toString(16).padStart(2, "0")).join("");
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function toUploadInitPayload(file, checksumSha256) {
  return {
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    fileSize: file.size,
    checksumSha256
  };
}

export async function uploadMediaInChunks({ file, onProgress }) {
  if (!file) {
    throw new Error("No file selected");
  }

  const checksumSha256 = await sha256HexFromBlob(file);
  const initResult = await initUpload(
    toUploadInitPayload(file, checksumSha256),
    createIdempotencyKey("upload-init")
  );

  const totalParts = Math.ceil(file.size / initResult.partSize);
  let uploadedBytes = 0;
  let partNumber = 1;

  for (let offset = 0; offset < file.size; offset += initResult.partSize) {
    const chunk = file.slice(offset, Math.min(offset + initResult.partSize, file.size));
    await uploadPart(initResult.uploadId, partNumber, chunk);

    uploadedBytes += chunk.size;
    const percent = Math.min(100, Math.round((uploadedBytes / file.size) * 100));
    if (onProgress) {
      onProgress({
        uploadedBytes,
        totalBytes: file.size,
        percent,
        partNumber,
        totalParts
      });
    }

    partNumber += 1;
  }

  const completeResult = await completeUpload(
    initResult.uploadId,
    {
      checksumSha256
    },
    createIdempotencyKey("upload-complete")
  );

  return {
    ...completeResult,
    uploadId: initResult.uploadId,
    totalParts,
    checksumSha256
  };
}

function normalizeErrorMessage(error) {
  if (!error) {
    return "Upload failed";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error.message && typeof error.message === "string") {
    return error.message;
  }

  return "Upload failed";
}

function toSafeFileArray(files) {
  if (!files) {
    return [];
  }

  if (Array.isArray(files)) {
    return files.filter(Boolean);
  }

  return Array.from(files).filter(Boolean);
}

export async function uploadMediaFilesInChunks({
  files,
  maxConcurrent = 4,
  onFileProgress,
  onOverallProgress,
  uploadSingle = uploadMediaInChunks
}) {
  const queue = toSafeFileArray(files);
  if (queue.length === 0) {
    throw new Error("No files selected");
  }

  const safeMaxConcurrent =
    Number.isFinite(maxConcurrent) && maxConcurrent > 0 ? Math.floor(maxConcurrent) : 1;
  const workerCount = Math.max(1, Math.min(safeMaxConcurrent, queue.length));

  const totalBytes = queue.reduce((sum, file) => sum + file.size, 0);
  const uploadedBytesByIndex = queue.map(() => 0);
  const successful = [];
  const failed = [];

  let nextIndex = 0;
  let processedFiles = 0;
  let successfulCount = 0;
  let failedCount = 0;

  function emitOverallProgress() {
    if (!onOverallProgress) {
      return;
    }

    const uploadedBytes = uploadedBytesByIndex.reduce((sum, value) => sum + value, 0);
    const percent = Math.min(100, Math.round((processedFiles / queue.length) * 100));

    onOverallProgress({
      processedFiles,
      totalFiles: queue.length,
      successfulCount,
      failedCount,
      uploadedBytes,
      totalBytes,
      percent
    });
  }

  emitOverallProgress();

  async function worker() {
    while (true) {
      const fileIndex = nextIndex;
      nextIndex += 1;
      if (fileIndex >= queue.length) {
        return;
      }

      const file = queue[fileIndex];

      if (onFileProgress) {
        onFileProgress({
          fileIndex,
          fileName: file.name,
          uploadedBytes: 0,
          totalBytes: file.size,
          percent: 0,
          partNumber: 0,
          totalParts: 0,
          status: "uploading"
        });
      }

      try {
        const result = await uploadSingle({
          file,
          onProgress: (progress) => {
            uploadedBytesByIndex[fileIndex] = progress.uploadedBytes;
            if (onFileProgress) {
              onFileProgress({
                fileIndex,
                fileName: file.name,
                ...progress,
                status: "uploading"
              });
            }
            emitOverallProgress();
          }
        });

        uploadedBytesByIndex[fileIndex] = file.size;
        processedFiles += 1;
        successfulCount += 1;
        successful.push({
          fileIndex,
          fileName: file.name,
          fileSize: file.size,
          ...result
        });

        if (onFileProgress) {
          onFileProgress({
            fileIndex,
            fileName: file.name,
            uploadedBytes: file.size,
            totalBytes: file.size,
            percent: 100,
            partNumber: result.totalParts || 0,
            totalParts: result.totalParts || 0,
            status: "success",
            mediaId: result.mediaId,
            uploadId: result.uploadId
          });
        }

        emitOverallProgress();
      } catch (error) {
        const errorMessage = normalizeErrorMessage(error);
        processedFiles += 1;
        failedCount += 1;

        failed.push({
          fileIndex,
          fileName: file.name,
          fileSize: file.size,
          error: errorMessage
        });

        if (onFileProgress) {
          const uploadedBytes = uploadedBytesByIndex[fileIndex];
          const percent = file.size > 0 ? Math.min(99, Math.round((uploadedBytes / file.size) * 100)) : 0;
          onFileProgress({
            fileIndex,
            fileName: file.name,
            uploadedBytes,
            totalBytes: file.size,
            percent,
            partNumber: 0,
            totalParts: 0,
            status: "failed",
            error: errorMessage
          });
        }

        emitOverallProgress();
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return {
    totalFiles: queue.length,
    successfulCount,
    failedCount,
    totalBytes,
    successful,
    failed
  };
}

export async function uploadPhotoInChunks(options) {
  return uploadMediaInChunks(options);
}

export async function uploadPhotosInChunks(options) {
  return uploadMediaFilesInChunks(options);
}
