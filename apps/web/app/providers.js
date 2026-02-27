"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { UploadProvider } from "./components/upload-context";
import GlobalUploadProgress from "./components/global-upload-progress";
import { NotificationProvider } from "./components/NotificationProvider";

export default function Providers({ children }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false
          }
        }
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <UploadProvider>
        <NotificationProvider>
          {children}
          <GlobalUploadProgress />
        </NotificationProvider>
      </UploadProvider>
    </QueryClientProvider>
  );
}
