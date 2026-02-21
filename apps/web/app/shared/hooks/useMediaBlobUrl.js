"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { formatApiError } from "../../../lib/api";

export function useMediaBlobUrl({ queryKey, queryFn, staleTime = 5 * 60 * 1000, enabled = true }) {
  const [mediaUrl, setMediaUrl] = useState("");
  const [loadError, setLoadError] = useState("");

  const query = useQuery({
    queryKey,
    queryFn,
    staleTime,
    enabled
  });

  useEffect(() => {
    if (!query.data) {
      return;
    }

    const nextUrl = URL.createObjectURL(query.data);
    setMediaUrl(nextUrl);
    setLoadError("");

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [query.data]);

  useEffect(() => {
    if (query.isError) {
      setLoadError(formatApiError(query.error));
    }
  }, [query.error, query.isError]);

  return {
    ...query,
    mediaUrl,
    loadError
  };
}
