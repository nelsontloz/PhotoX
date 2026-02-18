import { fetchMediaContentBlob, fetchTimeline } from "../../lib/api";
import { clearSession, writeSession } from "../../lib/session";

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("timeline api integration", () => {
  beforeEach(() => {
    clearSession();
    writeSession({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      user: {
        id: "usr_123",
        email: "user@example.com",
        name: null
      }
    });
    vi.restoreAllMocks();
  });

  it("fetches timeline with filters and cursor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        items: [
          {
            id: "med_1",
            ownerId: "usr_123",
            takenAt: "2026-02-16T10:00:00.000Z",
            uploadedAt: "2026-02-16T10:05:00.000Z",
            mimeType: "image/jpeg",
            flags: {
              favorite: false,
              archived: false,
              hidden: false,
              deletedSoft: false
            }
          }
        ],
        nextCursor: "cursor-2"
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = await fetchTimeline({
      limit: 10,
      favorite: true,
      cursor: "cursor-1",
      from: "2026-02-01T00:00:00.000Z",
      to: "2026-02-28T23:59:59.999Z"
    });

    expect(payload.items).toHaveLength(1);
    expect(payload.nextCursor).toBe("cursor-2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/library/timeline?");
    expect(fetchMock.mock.calls[0][0]).toContain("favorite=true");
    expect(fetchMock.mock.calls[0][0]).toContain("cursor=cursor-1");
  });

  it("fetches media thumb content as blob", async () => {
    const blobPayload = new Blob([new Uint8Array([1, 2, 3, 4])], {
      type: "image/webp"
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(blobPayload, {
        status: 200,
        headers: {
          "content-type": "image/webp"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const blob = await fetchMediaContentBlob("med_1", "thumb");
    expect(blob.type).toBe("image/webp");
    expect(blob.size).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/media/med_1/content?variant=thumb");
  });

  it("fetches media small content as blob for modal view", async () => {
    const blobPayload = new Blob([new Uint8Array([5, 6, 7, 8])], {
      type: "image/webp"
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(blobPayload, {
        status: 200,
        headers: {
          "content-type": "image/webp"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const blob = await fetchMediaContentBlob("med_1", "small");
    expect(blob.type).toBe("image/webp");
    expect(blob.size).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/media/med_1/content?variant=small");
  });

  it("fetches media playback content as blob for modal video view", async () => {
    const blobPayload = new Blob([new Uint8Array([9, 8, 7, 6])], {
      type: "video/webm"
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(blobPayload, {
        status: 200,
        headers: {
          "content-type": "video/webm"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const blob = await fetchMediaContentBlob("med_2", "playback");
    expect(blob.type).toBe("video/webm");
    expect(blob.size).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/media/med_2/content?variant=playback");
  });
});
