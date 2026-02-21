"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { createAlbum, formatApiError } from "../../../lib/api";
import { Spinner } from "../../timeline/components/Spinner";

export function CreateAlbumModal({ onClose, onCreated }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => createAlbum({ title: title.trim() }),
    onSuccess: (album) => {
      queryClient.invalidateQueries({ queryKey: ["albums"] });
      onCreated(album);
    },
    onError: (err) => setError(formatApiError(err))
  });

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !createMutation.isPending) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-bold text-white">Create Album</h2>
          {!createMutation.isPending && (
            <button type="button" onClick={onClose} className="rounded-full p-1 text-white/60 hover:text-white hover:bg-white/10 transition-colors">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          )}
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Album Title</label>
            <input
              type="text"
              autoFocus
              className="w-full rounded-lg bg-white/10 border border-white/10 focus:border-primary outline-none px-3 py-2.5 text-sm text-white placeholder-slate-500 transition-colors"
              placeholder="e.g. Summer Trip 2026"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) {
                  createMutation.mutate();
                }
              }}
              maxLength={1024}
              disabled={createMutation.isPending}
            />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-white text-sm font-semibold py-2.5 transition-colors flex items-center justify-center gap-2"
              disabled={!title.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? <Spinner label="" size="sm" /> : null}
              Create
            </button>
            <button
              type="button"
              className="rounded-lg border border-white/10 text-slate-400 hover:text-white text-sm px-4 py-2 transition-colors"
              onClick={onClose}
              disabled={createMutation.isPending}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
