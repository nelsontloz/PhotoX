"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { fetchCurrentUser, formatApiError } from "../../../lib/api";
import { buildLoginPath } from "../../../lib/navigation";

export function useRequireSession({ redirectPath, requireAdmin = false, nonAdminRedirect = "/timeline" }) {
  const router = useRouter();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => fetchCurrentUser(),
    retry: false
  });

  useEffect(() => {
    if (!meQuery.isError) {
      return;
    }

    const message = formatApiError(meQuery.error);
    if (message.includes("AUTH_REQUIRED") || message.includes("AUTH_TOKEN")) {
      router.replace(buildLoginPath(redirectPath));
      return;
    }

    router.replace(buildLoginPath(redirectPath));
  }, [meQuery.error, meQuery.isError, redirectPath, router]);

  useEffect(() => {
    if (!requireAdmin || !meQuery.isSuccess) {
      return;
    }

    if (!meQuery.data?.user?.isAdmin) {
      router.replace(nonAdminRedirect);
    }
  }, [meQuery.data?.user?.isAdmin, meQuery.isSuccess, nonAdminRedirect, requireAdmin, router]);

  return {
    meQuery,
    user: meQuery.data?.user || null,
    isAuthorized: meQuery.isSuccess && (!requireAdmin || Boolean(meQuery.data?.user?.isAdmin))
  };
}
