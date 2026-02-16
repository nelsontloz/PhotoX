"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { fetchCurrentUser, formatApiError, logoutUser } from "../../lib/api";
import { buildLoginPath } from "../../lib/navigation";
import { clearSession, readRefreshToken } from "../../lib/session";
import { formatBytes, uploadPhotosInChunks } from "../../lib/upload";

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

export default function UploadPage() {
  const router = useRouter();
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [fileProgressByIndex, setFileProgressByIndex] = useState({});
  const [overallProgress, setOverallProgress] = useState(null);
  const [uploadSummary, setUploadSummary] = useState(null);
  const [uploadError, setUploadError] = useState("");

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
    setOverallProgress(null);
    setUploadSummary(null);
    setUploadError("");
    setFileProgressByIndex({});
    setSelectedFiles(files);
  }

  function handleStartUpload(event) {
    event.preventDefault();
    if (selectedFiles.length === 0) {
      setUploadError("Choose one or more files first (VALIDATION_ERROR)");
      return;
    }

    uploadMutation.mutate(selectedFiles);
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
    <main className="shell py-10">
      <section className="panel space-y-7 p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-ocean-900">Upload photos</h1>
            <p className="mt-1 text-sm text-ocean-700">
              Signed in as <span className="font-semibold">{meQuery.data.user.email}</span>
            </p>
          </div>

          <button type="button" className="btn btn-secondary" onClick={handleLogout}>
            Logout
          </button>
        </div>

        <form onSubmit={handleStartUpload} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ocean-800">Photo files</span>
            <input className="field" type="file" accept="image/*" multiple onChange={handleFileChange} />
          </label>

          {selectedFiles.length > 0 ? (
            <div className="space-y-1">
              <p className="help">
                {selectedFiles.length} selected ({formatBytes(selectedFiles.reduce((sum, file) => sum + file.size, 0))})
              </p>
              <ul className="max-h-40 space-y-1 overflow-auto pr-1 text-xs text-ocean-700">
                {selectedFiles.map((file, index) => (
                  <li key={`${file.name}-${file.size}-${index}`}>
                    {file.name} ({formatBytes(file.size)})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={uploadMutation.isPending || selectedFiles.length === 0}
          >
            {uploadMutation.isPending ? "Uploading files..." : "Start upload"}
          </button>
        </form>

        {overallProgress ? (
          <div className="space-y-2">
            <div className="h-3 w-full overflow-hidden rounded-full bg-[#dbe8ee]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-ocean-500 to-ocean-700 transition-all"
                style={{ width: progressWidth }}
              />
            </div>
            <p className="text-sm text-ocean-700">
              {overallProgress.percent}% - {overallProgress.processedFiles} of {overallProgress.totalFiles} files
              processed ({overallProgress.successfulCount} successful, {overallProgress.failedCount} failed)
            </p>
            <p className="help">
              {formatBytes(overallProgress.uploadedBytes)} transferred out of {formatBytes(overallProgress.totalBytes)}
            </p>
          </div>
        ) : null}

        {fileProgressList.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-ocean-800">Per-file status</p>
            <ul className="max-h-64 space-y-2 overflow-auto pr-1">
              {fileProgressList.map((progress) => (
                <li key={progress.fileIndex} className="rounded-xl border border-[#d6e5eb] bg-white px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ocean-900">{progress.fileName}</p>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ocean-700">
                      {statusLabel(progress.status)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-ocean-700">
                    {progress.percent || 0}% ({formatBytes(progress.uploadedBytes || 0)} / {formatBytes(progress.totalBytes || 0)})
                  </p>
                  {progress.status === "failed" && progress.error ? (
                    <p className="mt-1 text-xs text-red-700">{progress.error}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {uploadSummary ? (
          <div className="success space-y-2">
            <p>
              Upload batch finished: {uploadSummary.successfulCount} successful, {uploadSummary.failedCount} failed
              (max concurrency: 4).
            </p>
            {uploadSummary.successful.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-xs text-ocean-800">
                {uploadSummary.successful.map((item) => (
                  <li key={`${item.fileIndex}-${item.mediaId}`}>
                    {item.fileName}: mediaId={item.mediaId}, uploadId={item.uploadId}
                  </li>
                ))}
              </ul>
            ) : null}
            {uploadSummary.failed.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-xs text-red-700">
                {uploadSummary.failed.map((item) => (
                  <li key={`${item.fileIndex}-${item.fileName}`}>
                    {item.fileName}: {item.error}
                  </li>
                ))}
              </ul>
            ) : null}
            {uploadSummary.successfulCount > 0 ? (
              <Link href="/timeline" className="inline-flex text-sm font-semibold underline underline-offset-4">
                Open timeline
              </Link>
            ) : null}
          </div>
        ) : null}

        {uploadError ? <div className="error">{uploadError}</div> : null}
      </section>
    </main>
  );
}
