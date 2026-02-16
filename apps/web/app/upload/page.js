"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { fetchCurrentUser, formatApiError, logoutUser } from "../../lib/api";
import { buildLoginPath } from "../../lib/navigation";
import { clearSession, readRefreshToken } from "../../lib/session";
import { formatBytes, uploadPhotosInChunks } from "../../lib/upload";
import AppSidebar from "../components/app-sidebar";

function statusLabel(status) {
  if (status === "success") {
    return "Uploaded";
  }

  if (status === "failed") {
    return "Failed";
  }

  if (status === "uploading") {
    return "Uploading";
  }

  return "Queued";
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff", "avif"]);

function isImageFile(file) {
  if (typeof file?.type === "string" && file.type.startsWith("image/")) {
    return true;
  }

  const name = typeof file?.name === "string" ? file.name : "";
  const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  return Boolean(extension && IMAGE_EXTENSIONS.has(extension));
}

function statusChip(status) {
  if (status === "uploading") {
    return "bg-cyan-100 text-cyan-600";
  }

  if (status === "success") {
    return "bg-emerald-100 text-emerald-600";
  }

  if (status === "failed") {
    return "bg-red-100 text-red-600";
  }

  return "bg-slate-100 text-slate-600";
}

function queueCardStyle(status) {
  if (status === "failed") {
    return "border-red-200 bg-red-50/50";
  }

  return "border-slate-200 bg-white";
}

export default function UploadPage() {
  const router = useRouter();
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [fileProgressByIndex, setFileProgressByIndex] = useState({});
  const [overallProgress, setOverallProgress] = useState(null);
  const [uploadSummary, setUploadSummary] = useState(null);
  const [uploadError, setUploadError] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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
      uploadPhotosInChunks({
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

  const progressWidth = useMemo(() => {
    if (!overallProgress) {
      return "0%";
    }

    return `${overallProgress.percent}%`;
  }, [overallProgress]);

  const fileProgressList = useMemo(
    () => Object.values(fileProgressByIndex).sort((a, b) => a.fileIndex - b.fileIndex),
    [fileProgressByIndex]
  );

  const activeCount = useMemo(
    () => fileProgressList.filter((item) => item.status === "uploading" || item.status === "queued").length,
    [fileProgressList]
  );

  async function handleLogout() {
    const refreshToken = readRefreshToken();
    if (refreshToken) {
      try {
        await logoutUser(refreshToken);
      } catch (_error) {
        // no-op, local logout still proceeds
      }
    }

    clearSession();
    router.replace("/login");
  }

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
      setUploadError("Upload already in progress. Wait for it to finish before selecting more files (UPLOAD_IN_PROGRESS)");
      return;
    }

    const validFiles = files.filter(isImageFile);
    const rejectedCount = files.length - validFiles.length;

    if (validFiles.length === 0) {
      setUploadError("Only image files are supported right now (VALIDATION_ERROR)");
      return;
    }

    setOverallProgress(null);
    setUploadSummary(null);
    setFileProgressByIndex({});
    setSelectedFiles(validFiles);

    if (rejectedCount > 0) {
      setUploadError(`${rejectedCount} non-image file(s) were skipped. Only image uploads are supported (VALIDATION_ERROR)`);
    } else {
      setUploadError("");
    }

    uploadMutation.mutate(validFiles);
  }

  function handleClearFinished() {
    setFileProgressByIndex((previous) => {
      const remaining = {};
      for (const [index, value] of Object.entries(previous)) {
        if (value.status !== "success" && value.status !== "failed") {
          remaining[index] = value;
        }
      }
      return remaining;
    });
  }

  if (meQuery.isPending) {
    return (
      <main className="shell py-10">
        <section className="panel p-8">
          <p className="text-sm text-ocean-700">Validating session...</p>
        </section>
      </main>
    );
  }

  if (meQuery.isError) {
    return null;
  }

  return (
    <div className="relative flex min-h-[calc(100vh-61px)] bg-[#f6f8f8] text-slate-900">
      {isSidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          aria-label="Close sidebar"
          onClick={() => setIsSidebarOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-[61px] left-0 z-40 w-64 border-r border-slate-200 bg-white transition-transform duration-300 lg:static lg:inset-auto lg:flex lg:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <AppSidebar activeLabel="Photos" />
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 md:px-10">
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 lg:hidden"
              onClick={() => setIsSidebarOpen(true)}
            >
              Menu
            </button>
            <h2 className="text-xl font-bold tracking-tight">PhotoX</h2>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="hidden md:inline">{meQuery.data.user.email}</span>
            <button type="button" className="btn btn-secondary" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-black tracking-tight text-slate-900 md:text-4xl">Upload Manager</h1>
            <p className="text-lg text-slate-500">Manage your photo and video uploads to your private cloud.</p>
          </div>

          <div className="space-y-8">
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileChange}
            />

            <div
              className="group relative flex flex-col items-center justify-center gap-6 rounded-xl border-2 border-dashed border-cyan-400/40 bg-white px-6 py-16 transition-all duration-200 hover:border-cyan-500 hover:bg-cyan-50/40"
              onDrop={handleDrop}
              onDragOver={(event) => event.preventDefault()}
            >
              <div className="mb-2 rounded-full bg-cyan-100 p-4 text-cyan-500 transition-transform duration-300 group-hover:scale-110">
                <span className="text-3xl font-black">UP</span>
              </div>
              <div className="max-w-[480px] text-center">
                <p className="text-xl font-bold text-slate-900">Drag & drop photos here</p>
                <p className="text-sm text-slate-500">Supports image files only (JPG, PNG, HEIC, WebP, AVIF; Max 2GB per file)</p>
              </div>
              <div className="flex w-full items-center justify-center gap-3">
                <span className="h-px w-16 bg-slate-200" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">OR</span>
                <span className="h-px w-16 bg-slate-200" />
              </div>
              <button
                type="button"
                className="rounded-lg bg-cyan-500 px-8 py-3 text-base font-bold tracking-wide text-white shadow-lg shadow-cyan-200 transition-all hover:bg-cyan-600"
                onClick={() => fileInputRef.current?.click()}
              >
                Select Files
              </button>
            </div>

            {overallProgress ? (
              <div className="space-y-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full bg-cyan-500 transition-all" style={{ width: progressWidth }} />
                </div>
                <p className="text-sm text-slate-600">
                  {overallProgress.percent}% - {overallProgress.processedFiles} / {overallProgress.totalFiles} files
                </p>
              </div>
            ) : null}

            <div className="flex flex-col gap-4">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-bold text-slate-900">Upload Queue</h3>
                  <span className="rounded-full bg-cyan-100 px-2.5 py-0.5 text-xs font-bold text-cyan-600">{activeCount} Active</span>
                </div>
                <button
                  type="button"
                  className="text-sm font-medium text-slate-500 transition-colors hover:text-cyan-600"
                  onClick={handleClearFinished}
                >
                  Clear Finished
                </button>
              </div>

              <div className="flex flex-col gap-3">
                {fileProgressList.length === 0 && selectedFiles.length > 0
                  ? selectedFiles.map((file, index) => (
                      <div key={`${file.name}-${file.size}-${index}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center justify-between gap-4">
                          <p className="truncate text-base font-medium text-slate-900">{file.name}</p>
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-slate-600">
                            Queued
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{formatBytes(file.size)}</p>
                      </div>
                    ))
                  : null}

                {fileProgressList.map((progress) => (
                  <div
                    key={progress.fileIndex}
                    className={`relative overflow-hidden rounded-xl border p-4 shadow-sm ${queueCardStyle(progress.status)}`}
                  >
                    <div className="absolute bottom-0 left-0 h-1 bg-cyan-500 transition-all" style={{ width: `${progress.percent || 0}%` }} />
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <p className="truncate pr-4 text-base font-bold text-slate-900">{progress.fileName}</p>
                          <span className={`hidden rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider sm:inline-block ${statusChip(progress.status)}`}>
                            {statusLabel(progress.status)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm text-slate-500">
                          <span>
                            {formatBytes(progress.totalBytes || 0)} - {progress.percent || 0}%
                          </span>
                          <span className="font-mono text-xs">{formatBytes(progress.uploadedBytes || 0)}</span>
                        </div>
                        {progress.status === "failed" && progress.error ? (
                          <p className="mt-1 text-sm font-medium text-red-500">{progress.error}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {uploadMutation.isPending ? (
                <div className="rounded-lg bg-cyan-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-cyan-200">
                  Uploading files...
                </div>
              ) : null}
              {uploadSummary?.successfulCount > 0 ? (
                <Link href="/timeline" className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-6 py-3 text-sm font-bold text-slate-800">
                  Open timeline
                </Link>
              ) : null}
            </div>
          </div>

          {uploadSummary ? (
            <div className="success space-y-2">
              <p>
                Upload batch finished: {uploadSummary.successfulCount} successful, {uploadSummary.failedCount} failed
                (max concurrency: 4).
              </p>
            </div>
          ) : null}

          {uploadError ? <div className="error">{uploadError}</div> : null}
        </div>
      </main>
    </div>
  );
}
