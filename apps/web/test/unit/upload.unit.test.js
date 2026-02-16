import { describe, expect, it, vi } from "vitest";
import { formatBytes, uploadPhotoInChunks, uploadPhotosInChunks } from "../../lib/upload";
import * as api from "../../lib/api";

// Mock API for uploadPhotoInChunks test
vi.mock("../../lib/api", () => ({
  initUpload: vi.fn(),
  uploadPart: vi.fn(),
  completeUpload: vi.fn(),
  createIdempotencyKey: vi.fn((prefix) => `${prefix}-mock-id`),
}));

describe("upload helpers", () => {
  it("formats bytes in readable units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("uploads files with bounded concurrency", async () => {
    const files = Array.from({ length: 10 }, (_, index) => ({
      name: `photo-${index}.jpg`,
      size: 100
    }));

    let active = 0;
    let maxObservedConcurrency = 0;

    const uploadSingle = vi.fn(async ({ file, onProgress }) => {
      active += 1;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, active);

      onProgress({
        uploadedBytes: file.size,
        totalBytes: file.size,
        percent: 100,
        partNumber: 1,
        totalParts: 1
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;

      return {
        mediaId: `media-${file.name}`,
        uploadId: `upload-${file.name}`,
        totalParts: 1
      };
    });

    const overallEvents = [];
    const summary = await uploadPhotosInChunks({
      files,
      maxConcurrent: 4,
      uploadSingle,
      onOverallProgress: (event) => overallEvents.push(event)
    });

    expect(uploadSingle).toHaveBeenCalledTimes(10);
    expect(maxObservedConcurrency).toBeLessThanOrEqual(4);
    expect(summary.totalFiles).toBe(10);
    expect(summary.successfulCount).toBe(10);
    expect(summary.failedCount).toBe(0);
    expect(summary.successful).toHaveLength(10);
    expect(overallEvents[overallEvents.length - 1].percent).toBe(100);
  });

  it("continues processing remaining files when one fails", async () => {
    const files = [
      { name: "ok-1.jpg", size: 10 },
      { name: "bad.jpg", size: 20 },
      { name: "ok-2.jpg", size: 30 }
    ];

    const uploadSingle = vi.fn(async ({ file, onProgress }) => {
      onProgress({
        uploadedBytes: file.size,
        totalBytes: file.size,
        percent: 100,
        partNumber: 1,
        totalParts: 1
      });

      if (file.name === "bad.jpg") {
        throw new Error("VALIDATION_ERROR");
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
    expect(summary.totalFiles).toBe(3);
    expect(summary.successfulCount).toBe(2);
    expect(summary.failedCount).toBe(1);
    expect(summary.failed[0].fileName).toBe("bad.jpg");
    expect(summary.failed[0].error).toBe("VALIDATION_ERROR");
  });

  it("computes correct SHA-256 and uploads in chunks (single file)", async () => {
    const content = "hello world";
    const file = new File([content], "hello.txt", { type: "text/plain" });
    const expectedHash = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

    vi.mocked(api.initUpload).mockResolvedValue({
      uploadId: "upload-123",
      partSize: 5, // Force chunking
    });

    vi.mocked(api.completeUpload).mockResolvedValue({
      mediaId: "media-123",
    });

    vi.mocked(api.uploadPart).mockResolvedValue({});

    const onProgress = vi.fn();

    const result = await uploadPhotoInChunks({ file, onProgress });

    expect(api.initUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "hello.txt",
        checksumSha256: expectedHash,
      }),
      "upload-init-mock-id"
    );

    // "hello world" (11 bytes) / 5 bytes = 3 chunks
    expect(api.uploadPart).toHaveBeenCalledTimes(3);

    expect(api.completeUpload).toHaveBeenCalledWith(
      "upload-123",
      expect.objectContaining({
        checksumSha256: expectedHash,
      }),
      "upload-complete-mock-id"
    );

    expect(result.checksumSha256).toBe(expectedHash);
  });
});
