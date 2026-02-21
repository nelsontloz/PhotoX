"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { emptyTrash, fetchTrashPreviewBlob, formatApiError, listTrash, restoreMedia } from "../../lib/api";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { PageLayout } from "../components/PageLayout";
import { SessionLoadingScreen } from "../components/SessionLoadingScreen";
import { Spinner } from "../components/Spinner";
import { useRequireSession } from "../shared/hooks/useRequireSession";
import { useMediaBlobUrl } from "../shared/hooks/useMediaBlobUrl";

function formatDate(value) {
  if (!value) {
    return "Unknown";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }

  return parsed.toLocaleString();
}

function TrashPreview({ item }) {
  const { mediaUrl } = useMediaBlobUrl({
    queryKey: ["trash-preview", item.id],
    queryFn: () => fetchTrashPreviewBlob(item.id, "thumb")
  });

  if (!mediaUrl) {
    return (
      <div className="flex aspect-square items-center justify-center bg-slate-100 text-slate-500 dark:bg-gray-800 dark:text-slate-400">
        <span className="material-symbols-outlined text-2xl">image</span>
      </div>
    );
  }

  return <img src={mediaUrl} alt="Trashed media preview" className="aspect-square w-full object-cover" />;
}

export default function TrashPage() {
  const queryClient = useQueryClient();
  const [confirmEmptyOpen, setConfirmEmptyOpen] = useState(false);
  const { meQuery, user } = useRequireSession({ redirectPath: "/trash" });

  const trashQuery = useQuery({
    queryKey: ["trash"],
    queryFn: () => listTrash({ limit: 100 }),
    enabled: meQuery.isSuccess
  });

  const restoreMutation = useMutation({
    mutationFn: (mediaId) => restoreMedia(mediaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trash"] });
      queryClient.invalidateQueries({ queryKey: ["timeline"] });
      queryClient.invalidateQueries({ queryKey: ["albums"] });
      queryClient.invalidateQueries({ queryKey: ["album"] });
      queryClient.invalidateQueries({ queryKey: ["album-items"] });
    }
  });

  const emptyMutation = useMutation({
    mutationFn: () => emptyTrash(),
    onSuccess: () => {
      setConfirmEmptyOpen(false);
      queryClient.invalidateQueries({ queryKey: ["trash"] });
    }
  });

  const items = useMemo(() => trashQuery.data?.items || [], [trashQuery.data]);

  if (meQuery.isPending || meQuery.isError) {
    return <SessionLoadingScreen />;
  }

  return (
    <PageLayout activeLabel="Trash" isAdmin={Boolean(user?.isAdmin)} mainClassName="px-4 sm:px-8 pb-20 pt-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Trash</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Items are permanently deleted after 30 days unless restored.
          </p>
        </div>
        <button
          type="button"
          className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          disabled={items.length === 0 || emptyMutation.isPending}
          onClick={() => setConfirmEmptyOpen(true)}
        >
          {emptyMutation.isPending ? "Queueing..." : "Empty Trash"}
        </button>
      </div>

      {confirmEmptyOpen ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/40">
          <p className="text-sm text-red-800 dark:text-red-200">
            Empty Trash will queue immediate permanent deletion for all trashed items.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className="rounded-full bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              onClick={() => emptyMutation.mutate()}
              disabled={emptyMutation.isPending}
            >
              Confirm Empty Trash
            </button>
            <button
              type="button"
              className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
              onClick={() => setConfirmEmptyOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {trashQuery.isError ? <ErrorBanner message={formatApiError(trashQuery.error)} /> : null}
      {restoreMutation.isError ? <ErrorBanner message={formatApiError(restoreMutation.error)} className="mt-3" /> : null}
      {emptyMutation.isError ? <ErrorBanner message={formatApiError(emptyMutation.error)} className="mt-3" /> : null}

      {trashQuery.isPending ? (
        <div className="flex justify-center py-12">
          <Spinner label="Loading trash..." />
        </div>
      ) : null}

      {!trashQuery.isPending && items.length === 0 ? (
        <EmptyState
          icon="delete_outline"
          title="Trash is empty"
          description="Deleted media will appear here and can be restored within 30 days."
        />
      ) : null}

      {items.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <div key={item.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-border-dark dark:bg-card-dark">
              <TrashPreview item={item} />
              <div className="p-4">
              <p className="text-xs font-semibold text-slate-900 dark:text-white break-all">{item.id}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.mimeType}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Deleted: {formatDate(item.deletedAt)}
              </p>
              <button
                type="button"
                className="mt-4 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
                onClick={() => restoreMutation.mutate(item.id)}
                disabled={restoreMutation.isPending}
              >
                Restore
              </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </PageLayout>
  );
}
