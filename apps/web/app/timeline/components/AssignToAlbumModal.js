"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { listAlbums, createAlbum, addMediaToAlbum, formatApiError } from "../../../lib/api";
import { Spinner } from "./Spinner";

/**
 * AssignToAlbumModal
 * Props:
 *   selectedIds — Set<string> of media IDs to assign
 *   onClose     — () => void
 *   onSuccess   — () => void  (clears selection + closes)
 */
export function AssignToAlbumModal({ selectedIds, onClose, onSuccess }) {
    const queryClient = useQueryClient();
    const [phase, setPhase] = useState("pick"); // pick | creating | assigning | done
    const [newAlbumTitle, setNewAlbumTitle] = useState("");
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [createError, setCreateError] = useState("");
    const [assignResults, setAssignResults] = useState([]); // [{ mediaId, ok, error }]
    const [assignError, setAssignError] = useState("");

    const albumsQuery = useQuery({
        queryKey: ["albums"],
        queryFn: () => listAlbums(),
        staleTime: 30_000
    });

    const count = selectedIds.size;
    const mediaIds = Array.from(selectedIds);

    const doAssign = useCallback(async (albumId) => {
        setPhase("assigning");
        setAssignError("");

        const results = await Promise.allSettled(
            mediaIds.map((mediaId) => addMediaToAlbum(albumId, { mediaId }))
        );

        const mapped = results.map((r, i) => ({
            mediaId: mediaIds[i],
            ok: r.status === "fulfilled",
            error: r.status === "rejected" ? formatApiError(r.reason) : null
        }));

        setAssignResults(mapped);
        setPhase("done");

        // Invalidate album queries so counts refresh
        queryClient.invalidateQueries({ queryKey: ["albums"] });
        queryClient.invalidateQueries({ queryKey: ["album-items", albumId] });
    }, [mediaIds, queryClient]);

    const handleCreateAndAssign = useCallback(async () => {
        const title = newAlbumTitle.trim();
        if (!title) {
            setCreateError("Album title is required.");
            return;
        }
        setCreateError("");
        setPhase("creating");

        try {
            const album = await createAlbum({ title });
            queryClient.invalidateQueries({ queryKey: ["albums"] });
            await doAssign(album.id);
        } catch (err) {
            setCreateError(formatApiError(err));
            setPhase("pick");
        }
    }, [newAlbumTitle, doAssign, queryClient]);

    const successCount = assignResults.filter((r) => r.ok).length;
    const failCount = assignResults.filter((r) => !r.ok).length;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={(e) => {
                if (e.target === e.currentTarget && phase !== "assigning") onClose();
            }}
        >
            <div className="relative w-full max-w-md rounded-2xl bg-slate-900 border border-white/10 shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                    <h2 className="text-base font-bold text-white">
                        {phase === "done"
                            ? "Done"
                            : `Add ${count} photo${count !== 1 ? "s" : ""} to Album`}
                    </h2>
                    {phase !== "assigning" && (
                        <button
                            type="button"
                            className="rounded-full p-1 text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                            onClick={onClose}
                        >
                            <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                    )}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4 max-h-[60vh]">
                    {/* Loading */}
                    {phase === "pick" && albumsQuery.isPending && (
                        <div className="flex justify-center py-8">
                            <Spinner label="Loading albums..." />
                        </div>
                    )}

                    {/* Error loading albums */}
                    {phase === "pick" && albumsQuery.isError && (
                        <p className="text-red-400 text-sm text-center py-6">
                            {formatApiError(albumsQuery.error)}
                        </p>
                    )}

                    {/* Creating album spinner */}
                    {phase === "creating" && (
                        <div className="flex justify-center py-8">
                            <Spinner label="Creating album..." />
                        </div>
                    )}

                    {/* Assigning spinner */}
                    {phase === "assigning" && (
                        <div className="flex flex-col items-center gap-3 py-8">
                            <Spinner label={`Adding ${count} photo${count !== 1 ? "s" : ""}...`} />
                        </div>
                    )}

                    {/* Done */}
                    {phase === "done" && (
                        <div className="flex flex-col items-center gap-4 py-6">
                            <div className={`size-16 rounded-full flex items-center justify-center ${failCount === 0 ? "bg-green-500/20" : "bg-yellow-500/20"}`}>
                                <span className={`material-symbols-outlined text-4xl ${failCount === 0 ? "text-green-400" : "text-yellow-400"}`}>
                                    {failCount === 0 ? "check_circle" : "warning"}
                                </span>
                            </div>
                            <p className="text-white font-semibold text-center">
                                {successCount} photo{successCount !== 1 ? "s" : ""} added
                                {failCount > 0 ? `, ${failCount} failed` : ""}
                            </p>
                            {failCount > 0 && (
                                <ul className="w-full text-xs text-red-400 space-y-1">
                                    {assignResults.filter((r) => !r.ok).map((r) => (
                                        <li key={r.mediaId} className="truncate">• {r.mediaId}: {r.error}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}

                    {/* Album picker */}
                    {phase === "pick" && albumsQuery.isSuccess && (
                        <div className="flex flex-col gap-3">
                            {/* Existing albums */}
                            {albumsQuery.data?.items?.length > 0 ? (
                                <div className="flex flex-col gap-2">
                                    {albumsQuery.data.items.map((album) => (
                                        <button
                                            key={album.id}
                                            type="button"
                                            className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-primary/60 px-4 py-3 text-left transition-all group"
                                            onClick={() => doAssign(album.id)}
                                        >
                                            <div className="size-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                                                <span className="material-symbols-outlined text-[22px] text-slate-400 group-hover:text-primary transition-colors">photo_library</span>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-semibold text-white truncate">{album.title}</p>
                                                <p className="text-xs text-slate-400 mt-0.5">{album.mediaCount ?? 0} photo{(album.mediaCount ?? 0) !== 1 ? "s" : ""}</p>
                                            </div>
                                            <span className="material-symbols-outlined text-[20px] text-slate-500 group-hover:text-primary transition-colors">chevron_right</span>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-slate-400 text-sm text-center py-4">No albums yet. Create one below.</p>
                            )}

                            {/* Divider */}
                            <div className="border-t border-white/10 my-1" />

                            {/* Create new album */}
                            {!showCreateForm ? (
                                <button
                                    type="button"
                                    className="flex items-center gap-3 rounded-xl border-2 border-dashed border-white/20 hover:border-primary/60 px-4 py-3 text-left transition-all group"
                                    onClick={() => setShowCreateForm(true)}
                                >
                                    <div className="size-10 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                                        <span className="material-symbols-outlined text-[22px] text-slate-400 group-hover:text-primary transition-colors">add</span>
                                    </div>
                                    <span className="text-sm font-semibold text-slate-300 group-hover:text-white transition-colors">Create New Album</span>
                                </button>
                            ) : (
                                <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">New Album Title</label>
                                    <input
                                        type="text"
                                        autoFocus
                                        className="w-full rounded-lg bg-white/10 border border-white/10 focus:border-primary outline-none px-3 py-2 text-sm text-white placeholder-slate-500 transition-colors"
                                        placeholder="e.g. Summer Trip 2026"
                                        value={newAlbumTitle}
                                        onChange={(e) => { setNewAlbumTitle(e.target.value); setCreateError(""); }}
                                        onKeyDown={(e) => { if (e.key === "Enter") handleCreateAndAssign(); }}
                                        maxLength={1024}
                                    />
                                    {createError && <p className="text-red-400 text-xs">{createError}</p>}
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            className="flex-1 rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-semibold py-2 transition-colors"
                                            onClick={handleCreateAndAssign}
                                        >
                                            Create &amp; Add
                                        </button>
                                        <button
                                            type="button"
                                            className="rounded-lg border border-white/10 text-slate-400 hover:text-white text-sm px-4 py-2 transition-colors"
                                            onClick={() => { setShowCreateForm(false); setCreateError(""); setNewAlbumTitle(""); }}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                {phase === "done" && (
                    <div className="px-6 py-4 border-t border-white/10">
                        <button
                            type="button"
                            className="w-full rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-semibold py-2.5 transition-colors"
                            onClick={onSuccess}
                        >
                            Done
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
