"use client";

import { useState } from "react";

export function useTimelineSelection() {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  function toggleSelectionMode() {
    setSelectionMode((prev) => !prev);
    setSelectedIds(new Set());
  }

  function selectItem(mediaId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(mediaId)) {
        next.delete(mediaId);
      } else {
        next.add(mediaId);
      }
      return next;
    });
  }

  function selectAllInSection(items) {
    setSelectionMode(true);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      items.forEach((item) => next.add(item.id));
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function closeSelection() {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }

  return {
    selectionMode,
    selectedIds,
    toggleSelectionMode,
    selectItem,
    selectAllInSection,
    clearSelection,
    closeSelection,
    setSelectionMode,
    setSelectedIds
  };
}
