const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const sharp = require("sharp");

const { createMediaDerivativesProcessor } = require("../../src/queues/mediaDerivativesWorker");

describe("media derivatives processor", () => {
  const originalsRoot = path.join(os.tmpdir(), "photox-worker-originals-tests");
  const derivedRoot = path.join(os.tmpdir(), "photox-worker-derived-tests");

  beforeEach(async () => {
    await fs.rm(originalsRoot, { recursive: true, force: true });
    await fs.rm(derivedRoot, { recursive: true, force: true });
    await fs.mkdir(originalsRoot, { recursive: true });
    await fs.mkdir(derivedRoot, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(originalsRoot, { recursive: true, force: true });
    await fs.rm(derivedRoot, { recursive: true, force: true });
  });

  it("writes thumb and small webp derivatives", async () => {
    const mediaId = "26d36300-6d7a-4fae-ac76-3f7f2f9f8f32";
    const ownerId = "0f3c9d30-1307-4c9e-a4d7-75e84606c28d";
    const relativePath = `${ownerId}/2026/02/${mediaId}.jpg`;
    const sourceAbsolutePath = path.join(originalsRoot, ownerId, "2026", "02", `${mediaId}.jpg`);

    await fs.mkdir(path.dirname(sourceAbsolutePath), { recursive: true });
    await sharp({
      create: {
        width: 1400,
        height: 900,
        channels: 3,
        background: {
          r: 70,
          g: 100,
          b: 150
        }
      }
    })
      .jpeg()
      .toFile(sourceAbsolutePath);

    const logger = {
      info() {},
      error() {}
    };

    const processor = createMediaDerivativesProcessor({
      originalsRoot,
      derivedRoot,
      logger
    });

    const result = await processor({
      id: "job-1",
      queueName: "media.derivatives.generate",
      data: {
        mediaId,
        relativePath
      }
    });

    expect(result.mediaId).toBe(mediaId);
    expect(result.derivatives).toHaveLength(2);

    const thumbPath = path.join(derivedRoot, ownerId, "2026", "02", `${mediaId}-thumb.webp`);
    const smallPath = path.join(derivedRoot, ownerId, "2026", "02", `${mediaId}-small.webp`);
    await expect(fs.stat(thumbPath)).resolves.toBeTruthy();
    await expect(fs.stat(smallPath)).resolves.toBeTruthy();
  });

  it("rejects invalid payloads", async () => {
    const processor = createMediaDerivativesProcessor({
      originalsRoot,
      derivedRoot,
      logger: {
        info() {},
        error() {}
      }
    });

    await expect(
      processor({
        id: "job-2",
        queueName: "media.derivatives.generate",
        data: {
          mediaId: "missing-path"
        }
      })
    ).rejects.toThrow("Invalid derivatives job payload");
  });
});
