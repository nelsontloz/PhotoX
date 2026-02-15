import { uploadPhotoInChunks } from "../../lib/upload";
import { clearSession, writeSession } from "../../lib/session";

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("upload integration", () => {
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

  it("uploads file parts and completes upload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(201, {
          uploadId: "upload-123",
          partSize: 5,
          expiresAt: "2026-02-15T18:00:00.000Z"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          uploadId: "upload-123",
          partNumber: 1,
          bytesStored: 5,
          checksumSha256: "abc"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          uploadId: "upload-123",
          partNumber: 2,
          bytesStored: 3,
          checksumSha256: "def"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          mediaId: "media-123",
          status: "processing"
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const blob = new Blob([new TextEncoder().encode("abcdefgh")], {
      type: "image/jpeg"
    });
    const file = {
      name: "photo.jpg",
      size: blob.size,
      type: blob.type,
      arrayBuffer: () => blob.arrayBuffer(),
      slice: (start, end) => blob.slice(start, end)
    };

    const progressEvents = [];
    const result = await uploadPhotoInChunks({
      file,
      onProgress: (event) => progressEvents.push(event)
    });

    expect(result.mediaId).toBe("media-123");
    expect(result.uploadId).toBe("upload-123");
    expect(progressEvents.length).toBe(2);
    expect(progressEvents[1].percent).toBe(100);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0][0]).toContain("/uploads/init");
    expect(fetchMock.mock.calls[3][0]).toContain("/uploads/upload-123/complete");
  });
});
