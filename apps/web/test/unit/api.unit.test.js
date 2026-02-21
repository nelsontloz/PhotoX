import {
  ApiClientError,
  deleteMedia,
  emptyTrash,
  fetchTrashPreviewBlob,
  fetchWorkerTelemetrySnapshot,
  isRetriableMediaProcessingError,
  listTrash,
  openWorkerTelemetryStream,
  restoreMedia
} from "../../lib/api";
import { clearSession, writeSession } from "../../lib/session";

describe("api helpers", () => {
  beforeEach(() => {
    clearSession();
    vi.restoreAllMocks();
    writeSession({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      user: {
        id: "usr_admin",
        email: "admin@example.com",
        isAdmin: true,
        isActive: true
      }
    });
  });

  it("returns true for retriable playback derivative not ready errors", () => {
    const err = new ApiClientError(503, "PLAYBACK_DERIVATIVE_NOT_READY", "retry later", {
      retriable: true,
      queued: true
    });

    expect(isRetriableMediaProcessingError(err)).toBe(true);
  });

  it("returns false for non-retriable api errors", () => {
    const err = new ApiClientError(400, "VALIDATION_ERROR", "bad input", {});
    expect(isRetriableMediaProcessingError(err)).toBe(false);
  });

  it("fetches worker telemetry snapshot through admin api", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: "2026-02-telemetry-v1",
          generatedAt: "2026-02-18T00:00:00.000Z",
          queueCounts: {},
          counters: {},
          rates: {},
          workerHealth: {},
          inFlightJobs: [],
          recentFailures: {},
          recentEvents: []
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);
    const payload = await fetchWorkerTelemetrySnapshot();

    expect(payload.schemaVersion).toBe("2026-02-telemetry-v1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/worker/telemetry/snapshot");
  });

  it("parses SSE stream messages for worker telemetry", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: state_sync\ndata: {"state":{"schemaVersion":"2026-02-telemetry-v1","queueCounts":{},"counters":{},"rates":{},"workerHealth":{},"inFlightJobs":[],"recentFailures":{},"recentEvents":[],"generatedAt":"2026-02-18T00:00:00.000Z"}}\n\n'
          )
        );
        controller.close();
      }
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/event-stream"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const seen = [];
    await new Promise((resolve) => {
      openWorkerTelemetryStream({
        onMessage: (message) => {
          seen.push(message);
          resolve();
        },
        onError: () => resolve()
      });
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].event).toBe("state_sync");
  });

  it("calls trash and media lifecycle endpoints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [], nextCursor: null }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "queued", queuedCount: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/webp" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ mediaId: "m1", status: "deleted" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ mediaId: "m1", status: "active" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    await listTrash({ limit: 24 });
    await emptyTrash();
    await fetchTrashPreviewBlob("m1", "thumb");
    await deleteMedia("m1");
    await restoreMedia("m1");

    expect(fetchMock.mock.calls[0][0]).toContain("/library/trash?limit=24");
    expect(fetchMock.mock.calls[1][0]).toContain("/library/trash");
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
    expect(fetchMock.mock.calls[2][0]).toContain("/library/trash/m1/preview?variant=thumb");
    expect(fetchMock.mock.calls[2][1].method).toBe("GET");
    expect(fetchMock.mock.calls[3][0]).toContain("/media/m1");
    expect(fetchMock.mock.calls[3][1].method).toBe("DELETE");
    expect(fetchMock.mock.calls[4][0]).toContain("/media/m1/restore");
    expect(fetchMock.mock.calls[4][1].method).toBe("POST");
  });
});
