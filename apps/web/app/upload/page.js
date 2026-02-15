"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { fetchCurrentUser, formatApiError, logoutUser } from "../../lib/api";
import { buildLoginPath } from "../../lib/navigation";
import { clearSession, readRefreshToken } from "../../lib/session";
import { formatBytes, uploadPhotoInChunks } from "../../lib/upload";

export default function UploadPage() {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [uploadResult, setUploadResult] = useState(null);
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
    mutationFn: (file) =>
      uploadPhotoInChunks({
        file,
        onProgress: (nextProgress) => {
          setUploadProgress(nextProgress);
        }
      }),
    onMutate: () => {
      setUploadError("");
      setUploadResult(null);
      setUploadProgress({
        uploadedBytes: 0,
        totalBytes: selectedFile ? selectedFile.size : 0,
        percent: 0,
        partNumber: 0,
        totalParts: 0
      });
    },
    onSuccess: (result) => {
      setUploadResult(result);
    },
    onError: (error) => {
      setUploadError(formatApiError(error));
    }
  });

  const progressWidth = useMemo(() => {
    if (!uploadProgress) {
      return "0%";
    }
    return `${uploadProgress.percent}%`;
  }, [uploadProgress]);

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
    const file = event.target.files && event.target.files[0] ? event.target.files[0] : null;
    setUploadProgress(null);
    setUploadResult(null);
    setUploadError("");
    setSelectedFile(file);
  }

  function handleStartUpload(event) {
    event.preventDefault();
    if (!selectedFile) {
      setUploadError("Choose a file first (VALIDATION_ERROR)");
      return;
    }

    uploadMutation.mutate(selectedFile);
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
            <span className="mb-1 block text-sm font-semibold text-ocean-800">Photo file</span>
            <input className="field" type="file" accept="image/*" onChange={handleFileChange} />
          </label>

          {selectedFile ? (
            <p className="help">
              {selectedFile.name} ({formatBytes(selectedFile.size)})
            </p>
          ) : null}

          <button type="submit" className="btn btn-primary" disabled={uploadMutation.isPending || !selectedFile}>
            {uploadMutation.isPending ? "Uploading..." : "Start upload"}
          </button>
        </form>

        {uploadProgress ? (
          <div className="space-y-2">
            <div className="h-3 w-full overflow-hidden rounded-full bg-[#dbe8ee]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-ocean-500 to-ocean-700 transition-all"
                style={{ width: progressWidth }}
              />
            </div>
            <p className="text-sm text-ocean-700">
              {uploadProgress.percent}% ({formatBytes(uploadProgress.uploadedBytes)} / {formatBytes(uploadProgress.totalBytes)})
              {uploadProgress.totalParts > 0
                ? ` - part ${uploadProgress.partNumber} of ${uploadProgress.totalParts}`
                : ""}
            </p>
          </div>
        ) : null}

        {uploadResult ? (
          <div className="success">
            Upload accepted. Media is processing. mediaId={uploadResult.mediaId}, uploadId={uploadResult.uploadId}
          </div>
        ) : null}

        {uploadError ? <div className="error">{uploadError}</div> : null}
      </section>
    </main>
  );
}
