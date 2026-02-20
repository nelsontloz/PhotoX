"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { fetchCurrentUser, formatApiError } from "../../lib/api";
import { buildLoginPath } from "../../lib/navigation";
import { formatBytes, uploadMediaFilesInChunks } from "../../lib/upload";
import AppSidebar from "../components/app-sidebar";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff", "avif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "avi", "mkv", "3gp", "ogv", "wmv", "mpeg", "mpg"]);

function isSupportedMediaFile(file) {
  if (typeof file?.type === "string" && file.type.startsWith("image/")) {
    return true;
  }

  if (typeof file?.type === "string" && file.type.startsWith("video/")) {
    return true;
  }

  const name = typeof file?.name === "string" ? file.name : "";
  const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  return Boolean(extension && (IMAGE_EXTENSIONS.has(extension) || VIDEO_EXTENSIONS.has(extension)));
}

export default function UploadPage() {
  const router = useRouter();
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [fileProgressByIndex, setFileProgressByIndex] = useState({});
  const [overallProgress, setOverallProgress] = useState(null);
  const [uploadSummary, setUploadSummary] = useState(null);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef(null);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => fetchCurrentUser(),
    retry: false
  });

  useEffect(() => {
    if (meQuery.isError) {
      router.replace(buildLoginPath("/upload"));
    }
  }, [meQuery.isError, router]);

  const uploadMutation = useMutation({
    mutationFn: (files) =>
      uploadMediaFilesInChunks({
        files,
        maxConcurrent: 4,
        onFileProgress: (progress) => {
          setFileProgressByIndex((previous) => ({
            ...previous,
            [progress.fileIndex]: {
              ...(previous[progress.fileIndex] || {}),
              ...progress
            }
          }));
        },
        onOverallProgress: (progress) => {
          setOverallProgress(progress);
        }
      }),
    onMutate: (files) => {
      setUploadError("");
      setUploadSummary(null);

      const initialProgressByIndex = {};
      for (const [index, file] of files.entries()) {
        initialProgressByIndex[index] = {
          fileIndex: index,
          fileName: file.name,
          uploadedBytes: 0,
          totalBytes: file.size,
          percent: 0,
          partNumber: 0,
          totalParts: 0,
          status: "queued"
        };
      }

      setFileProgressByIndex(initialProgressByIndex);
      setOverallProgress({
        processedFiles: 0,
        totalFiles: files.length,
        successfulCount: 0,
        failedCount: 0,
        uploadedBytes: 0,
        totalBytes: files.reduce((sum, file) => sum + file.size, 0),
        percent: 0
      });
    },
    onSuccess: (summary) => {
      setUploadSummary(summary);
    },
    onError: (error) => {
      setUploadError(formatApiError(error));
    }
  });

  const fileProgressList = useMemo(
    () => Object.values(fileProgressByIndex).sort((a, b) => a.fileIndex - b.fileIndex),
    [fileProgressByIndex]
  );

  const activeCount = useMemo(
    () => fileProgressList.filter((item) => item.status === "uploading" || item.status === "queued").length,
    [fileProgressList]
  );

  function handleFileChange(event) {
    const files = event.target.files ? Array.from(event.target.files) : [];
    processSelectedFiles(files);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    processSelectedFiles(files);
  }

  function processSelectedFiles(files) {
    if (files.length === 0) {
      return;
    }

    if (uploadMutation.isPending) {
      setUploadError("Upload already in progress. Wait for it to finish before selecting more files");
      return;
    }

    const validFiles = files.filter(isSupportedMediaFile);
    const rejectedCount = files.length - validFiles.length;

    if (validFiles.length === 0) {
      setUploadError("Only image and video files are supported");
      return;
    }

    setOverallProgress(null);
    setUploadSummary(null);
    setFileProgressByIndex({});
    setSelectedFiles(validFiles);

    if (rejectedCount > 0) {
      setUploadError(`${rejectedCount} unsupported file(s) were skipped.`);
    } else {
      setUploadError("");
    }

    uploadMutation.mutate(validFiles);
  }

  function handleClearAll() {
    setFileProgressByIndex({});
    setSelectedFiles([]);
    setOverallProgress(null);
    setUploadSummary(null);
    setUploadError("");
  }

  if (meQuery.isPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-background-light dark:bg-background-dark">
        <p className="text-sm text-slate-500">Validating session...</p>
      </div>
    );
  }

  if (meQuery.isError) {
    return null;
  }

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-background-light dark:bg-background-dark">
      <AppSidebar activeLabel="Upload" isAdmin={Boolean(meQuery.data?.user?.isAdmin)} />

      <main className="flex-1 overflow-y-auto relative scroll-smooth flex flex-col">
        {/* Header Style Specific for Upload Control */}
        <div className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200 dark:border-border-dark bg-background-light/95 dark:bg-background-dark/95 backdrop-blur px-6 py-4 md:px-10 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold leading-tight tracking-tight text-slate-900 dark:text-white">Upload Manager</h2>
          </div>
          <Link
            href="/timeline"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary transition-colors"
          >
            <span className="material-symbols-outlined text-lg">arrow_back</span>
            <span className="hidden sm:inline">Back to Gallery</span>
          </Link>
        </div>

        <div className="w-full max-w-[960px] mx-auto p-4 md:p-8 flex flex-col gap-8 flex-1 pb-32">
          {/* Upload Area */}
          <section className="flex flex-col">
            <div
              className="group relative flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-slate-300 dark:border-border-dark bg-white dark:bg-card-dark px-6 py-16 transition-all hover:border-primary hover:bg-primary/5 dark:hover:border-primary dark:hover:bg-primary/5 cursor-pointer"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="flex size-16 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 group-hover:text-primary group-hover:scale-110 transition-all duration-300">
                <span className="material-symbols-outlined text-4xl">cloud_upload</span>
              </div>
              <div className="flex max-w-[480px] flex-col items-center gap-1 text-center">
                <p className="text-lg font-bold leading-tight text-slate-900 dark:text-white">Upload Photos</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Drag photos here or click to browse</p>
                <p className="text-xs text-slate-400 dark:text-slate-600 mt-2">Supports JPG, PNG, HEIC, WebP, AVIF, MP4, MOV up to 2GB</p>
              </div>
              <button className="mt-4 flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/30 transition-transform active:scale-95 hover:bg-blue-600">
                Select Files
              </button>
              <input
                ref={fileInputRef}
                className="hidden"
                multiple
                type="file"
                accept="image/*,video/*"
                onChange={handleFileChange}
              />
            </div>
          </section>

          {/* Error Message */}
          {uploadError && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 p-4 text-sm text-red-600 dark:text-red-400">
              {uploadError}
            </div>
          )}

          {/* Upload List Section */}
          {(fileProgressList.length > 0 || selectedFiles.length > 0) && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {uploadMutation.isPending ? `Uploading ${activeCount} files` : `Selected ${selectedFiles.length} files`}
                </h2>
                <button
                  onClick={handleClearAll}
                  className="text-sm font-medium text-slate-500 hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400 transition-colors"
                >
                  Clear All
                </button>
              </div>

              <div className="flex flex-col gap-3">
                {fileProgressList.length === 0 && selectedFiles.length > 0
                  ? selectedFiles.map((file, idx) => (
                    <UploadItem key={`${file.name}-${idx}`} fileName={file.name} fileSize={file.size} status="queued" />
                  ))
                  : fileProgressList.map((progress) => (
                    <UploadItem
                      key={progress.fileIndex}
                      fileName={progress.fileName}
                      fileSize={progress.totalBytes}
                      percent={progress.percent}
                      status={progress.status}
                      error={progress.error}
                    />
                  ))}
              </div>
            </section>
          )}
        </div>

        {/* Footer Actions */}
        <section className="sticky bottom-0 z-40 px-6 py-6 bg-background-light/95 dark:bg-background-dark/95 backdrop-blur border-t border-slate-200 dark:border-border-dark mt-auto shrink-0">
          <div className="max-w-[960px] mx-auto flex items-center justify-between">
            <div className="hidden sm:flex flex-col">
              <span className="text-sm font-medium text-slate-900 dark:text-white">Upload status</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {overallProgress ? `${overallProgress.processedFiles} of ${overallProgress.totalFiles} files processed` : "No active uploads"}
              </span>
            </div>
            <div className="flex flex-1 justify-end sm:flex-none w-full sm:w-auto gap-4">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full sm:w-auto rounded-lg border border-slate-300 dark:border-border-dark px-6 py-2.5 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                disabled={uploadMutation.isPending}
              >
                Add More
              </button>
              <button
                disabled={uploadMutation.isPending || (fileProgressList.length === 0 && selectedFiles.length === 0)}
                onClick={() => router.push("/timeline")}
                className="w-full sm:w-auto rounded-lg bg-primary px-8 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
              >
                Done
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function UploadItem({ fileName, fileSize, percent = 0, status, error }) {
  const isCompleted = status === "success";
  const isUploading = status === "uploading";
  const isFailed = status === "failed";

  return (
    <div className={`flex flex-col gap-3 rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark p-4 shadow-sm transition-all ${isFailed ? "border-red-200 dark:border-red-900/30" : ""}`}>
      <div className="flex items-center gap-4">
        <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
          {isFailed ? (
            <span className="material-symbols-outlined">broken_image</span>
          ) : (
            <span className="material-symbols-outlined">image</span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <div className="flex items-center justify-between mb-1">
            <p className="truncate text-sm font-medium leading-normal text-slate-900 dark:text-white">{fileName}</p>

            {isCompleted && (
              <div className="flex items-center gap-1 text-green-500 dark:text-green-400">
                <span className="material-symbols-outlined text-[18px]">check_circle</span>
                <span className="text-xs font-semibold">Completed</span>
              </div>
            )}

            {isUploading && (
              <div className="flex items-center gap-1 text-primary">
                <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                <span className="text-xs font-semibold">Uploading...</span>
              </div>
            )}

            {isFailed && (
              <div className="flex items-center gap-1 text-red-500 dark:text-red-400">
                <span className="material-symbols-outlined text-[18px]">error</span>
                <span className="text-xs font-semibold">Failed</span>
              </div>
            )}

            {status === "queued" && (
              <span className="text-xs font-semibold text-slate-400">Queued</span>
            )}
          </div>

          <div className="relative h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className={`absolute top-0 left-0 h-full rounded-full transition-all duration-300 ${isFailed ? "bg-red-500" : "bg-primary"}`}
              style={{ width: `${percent}%` }}
            ></div>
          </div>

          <div className="mt-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className={isFailed ? "text-red-500 dark:text-red-400" : ""}>{isFailed ? error || "Error" : formatBytes(fileSize)}</span>
            <span>{percent}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
