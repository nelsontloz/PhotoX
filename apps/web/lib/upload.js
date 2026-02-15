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

export async function uploadPhotoInChunks({ file, onProgress }) {
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
