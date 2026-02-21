"use client";

import { useEffect, useState } from "react";

import { fetchWorkerTelemetrySnapshot, openWorkerTelemetryStream } from "../../../lib/api";

export function useWorkerTelemetry(enabled) {
  const [workerTelemetry, setWorkerTelemetry] = useState(null);
  const [workerStreamStatus, setWorkerStreamStatus] = useState("connecting");

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let cancelled = false;
    let pollTimer = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    let streamSubscription = null;

    const loadSnapshot = async () => {
      const snapshot = await fetchWorkerTelemetrySnapshot();
      if (!cancelled) {
        setWorkerTelemetry(snapshot);
      }
    };

    const ensurePollingFallback = () => {
      if (pollTimer || cancelled) {
        return;
      }

      setWorkerStreamStatus("polling");
      loadSnapshot().catch(() => {});
      pollTimer = setInterval(() => {
        loadSnapshot().catch(() => {});
      }, 5000);
    };

    const connectStream = () => {
      if (cancelled) {
        return;
      }

      setWorkerStreamStatus("connecting");
      streamSubscription = openWorkerTelemetryStream({
        onOpen: () => {
          if (cancelled) {
            return;
          }

          reconnectAttempts = 0;
          setWorkerStreamStatus("connected");
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        },
        onMessage: ({ event, payload }) => {
          if (cancelled) {
            return;
          }

          if (event === "state_sync" && payload?.state) {
            setWorkerTelemetry(payload.state);
            return;
          }

          if (event === "event" && payload?.event) {
            setWorkerTelemetry((current) => {
              if (!current) {
                return current;
              }

              const nextEvents = [payload.event, ...(current.recentEvents || [])].slice(0, 120);
              return {
                ...current,
                recentEvents: nextEvents
              };
            });
          }
        },
        onError: () => {
          if (cancelled) {
            return;
          }

          ensurePollingFallback();
          reconnectAttempts += 1;
          const backoffMs = Math.min(30000, 1000 * 2 ** reconnectAttempts);
          setWorkerStreamStatus("reconnecting");

          reconnectTimer = setTimeout(() => {
            if (streamSubscription) {
              streamSubscription.close();
              streamSubscription = null;
            }
            connectStream();
          }, backoffMs);
        }
      });
    };

    loadSnapshot().catch(() => {
      ensurePollingFallback();
    });
    connectStream();

    return () => {
      cancelled = true;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (streamSubscription) {
        streamSubscription.close();
      }
    };
  }, [enabled]);

  return {
    workerTelemetry,
    workerStreamStatus
  };
}
