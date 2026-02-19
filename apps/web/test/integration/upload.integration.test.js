import { uploadPhotoInChunks, uploadPhotosInChunks } from "../../lib/upload";
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
  const ABCDEFGH_SHA256 = "9c56cc51b374c3ba189210d5b6d4bf57790d351c96c47c02190ecf1e430635ab";

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
      arrayBuffer: () => {
        throw new Error("full-file arrayBuffer must not be used");
      },
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

    const initPayload = JSON.parse(fetchMock.mock.calls[0][1].body);
    const completePayload = JSON.parse(fetchMock.mock.calls[3][1].body);
    expect(initPayload.checksumSha256).toBe(ABCDEFGH_SHA256);
    expect(completePayload.checksumSha256).toBe(ABCDEFGH_SHA256);
  });

  it("accepts video uploads and sends media content type during init", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(201, {
          uploadId: "upload-video-123",
          partSize: 4,
          expiresAt: "2026-02-15T18:00:00.000Z"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          uploadId: "upload-video-123",
          partNumber: 1,
          bytesStored: 4,
          checksumSha256: "abc"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          mediaId: "media-video-123",
          status: "processing"
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const blob = new Blob([new Uint8Array([0, 1, 2, 3])], {
      type: "video/mp4"
    });
    const file = {
      name: "clip.mp4",
      size: blob.size,
      type: blob.type,
      arrayBuffer: () => {
        throw new Error("full-file arrayBuffer must not be used");
      },
      slice: (start, end) => blob.slice(start, end)
    };

    const result = await uploadPhotoInChunks({ file });
    const initPayload = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(result.mediaId).toBe("media-video-123");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain("/uploads/init");
    expect(initPayload.fileName).toBe("clip.mp4");
    expect(initPayload.contentType).toBe("video/mp4");
  });

  it("aggregates per-file results for multi-file upload with continuation on failure", async () => {
    const files = [
      { name: "a.jpg", size: 4 },
      { name: "b.jpg", size: 4 },
      { name: "c.jpg", size: 4 }
    ];

    const uploadSingle = vi.fn(async ({ file, onProgress }) => {
      onProgress({
        uploadedBytes: file.size,
        totalBytes: file.size,
        percent: 100,
        partNumber: 1,
        totalParts: 1
      });

      if (file.name === "b.jpg") {
        throw new Error("NETWORK_ERROR");
      }

      return {
        mediaId: `media-${file.name}`,
        uploadId: `upload-${file.name}`,
        totalParts: 1
      };
    });

    const summary = await uploadPhotosInChunks({
      files,
      maxConcurrent: 4,
      uploadSingle
    });

    expect(uploadSingle).toHaveBeenCalledTimes(3);
    expect(summary.successfulCount).toBe(2);
    expect(summary.failedCount).toBe(1);
    expect(summary.failed[0].fileName).toBe("b.jpg");
  });
});
