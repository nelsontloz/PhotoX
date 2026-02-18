const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const sharp = require("sharp");

const { extractMediaMetadata } = require("../../src/media/metadata");

describe("media metadata extraction", () => {
  const tempRoot = path.join(os.tmpdir(), "photox-worker-metadata-tests");

  beforeEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("extracts image metadata with capture timestamp and gps", async () => {
    const filePath = path.join(tempRoot, "image.jpg");
    await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 20, g: 30, b: 40 }
      }
    })
      .jpeg()
      .toFile(filePath);

    const metadata = await extractMediaMetadata({
      sourceAbsolutePath: filePath,
      mimeType: "image/jpeg",
      uploadedAt: "2026-02-18T00:00:00.000Z",
      commandRunner: async () => ({
        stdout: JSON.stringify({
          format: {
            tags: {
              DateTimeOriginal: "2026:02:17 10:30:00",
              GPSLatitude: "37.7749",
              GPSLongitude: "-122.4194"
            }
          },
          streams: []
        }),
        stderr: ""
      })
    });

    expect(metadata.width).toBe(640);
    expect(metadata.height).toBe(480);
    expect(metadata.takenAt).toBe("2026-02-17T10:30:00.000Z");
    expect(metadata.location).toEqual({ lat: 37.7749, lon: -122.4194 });
  });

  it("extracts video metadata including duration, codec, and fps", async () => {
    const filePath = path.join(tempRoot, "video.mp4");
    await fs.writeFile(filePath, "video-placeholder");

    const metadata = await extractMediaMetadata({
      sourceAbsolutePath: filePath,
      mimeType: "video/mp4",
      uploadedAt: "2026-02-18T00:00:00.000Z",
      commandRunner: async () => ({
        stdout: JSON.stringify({
          format: {
            duration: "12.5",
            bit_rate: "1000000",
            tags: {
              creation_time: "2026-02-17T09:00:00.000Z"
            }
          },
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              width: 1920,
              height: 1080,
              avg_frame_rate: "30000/1001"
            }
          ]
        }),
        stderr: ""
      })
    });

    expect(metadata.takenAt).toBe("2026-02-17T09:00:00.000Z");
    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(1080);
    expect(metadata.exif.video.durationSec).toBeCloseTo(12.5, 5);
    expect(metadata.exif.video.codec).toBe("h264");
    expect(metadata.exif.video.fps).toBeCloseTo(29.970029, 3);
  });
});
