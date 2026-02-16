import { formatBytes, uploadPhotosInChunks } from "../../lib/upload";

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
});
