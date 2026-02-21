const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { createMediaCleanupProcessor } = require("../../src/queues/mediaDerivativesWorker");

describe("media cleanup processor", () => {
  const originalsRoot = path.join(os.tmpdir(), "photox-worker-cleanup-originals-tests");
  const derivedRoot = path.join(os.tmpdir(), "photox-worker-cleanup-derived-tests");

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

  it("hard-deletes files and rows when media is still soft deleted", async () => {
    const mediaId = "91f3ab59-5936-4cf4-8107-3af00940ad95";
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const relativePath = `${ownerId}/2026/02/${mediaId}.jpg`;

    const originalPath = path.join(originalsRoot, ownerId, "2026", "02", `${mediaId}.jpg`);
    const thumbPath = path.join(derivedRoot, ownerId, "2026", "02", `${mediaId}-thumb.webp`);
    await fs.mkdir(path.dirname(originalPath), { recursive: true });
    await fs.mkdir(path.dirname(thumbPath), { recursive: true });
    await fs.writeFile(originalPath, "original-bytes");
    await fs.writeFile(thumbPath, "thumb-bytes");

    const mediaRepo = {
      acquireProcessingLock: vi.fn().mockResolvedValue({
        acquired: true,
        mediaId,
        client: { query: vi.fn() },
        shouldReleaseClient: false
      }),
      releaseProcessingLock: vi.fn().mockResolvedValue(undefined),
      findCleanupCandidate: vi.fn().mockResolvedValue({
        id: mediaId,
        owner_id: ownerId,
        relative_path: relativePath,
        deleted_soft: true
      }),
      hardDeleteMediaGraphIfStillSoftDeleted: vi.fn().mockResolvedValue({ deleted: true })
    };

    const processor = createMediaCleanupProcessor({
      originalsRoot,
      derivedRoot,
      mediaRepo,
      logger: {
        info() {},
        warn() {},
        error() {}
      }
    });

    const result = await processor({
      id: "cleanup-job-1",
      queueName: "media.cleanup",
      data: { mediaId, ownerId }
    });

    expect(result).toEqual({ mediaId, status: "deleted" });
    expect(mediaRepo.hardDeleteMediaGraphIfStillSoftDeleted).toHaveBeenCalledWith(mediaId, ownerId);
    await expect(fs.stat(originalPath)).rejects.toHaveProperty("code", "ENOENT");
    await expect(fs.stat(thumbPath)).rejects.toHaveProperty("code", "ENOENT");
    expect(mediaRepo.releaseProcessingLock).toHaveBeenCalled();
  });

  it("skips cleanup when media has already been restored", async () => {
    const mediaId = "44f9cb98-f797-4c33-b9ea-b22f133d36d1";
    const ownerId = "11111111-1111-4111-8111-111111111111";

    const mediaRepo = {
      acquireProcessingLock: vi.fn().mockResolvedValue({
        acquired: true,
        mediaId,
        client: { query: vi.fn() },
        shouldReleaseClient: false
      }),
      releaseProcessingLock: vi.fn().mockResolvedValue(undefined),
      findCleanupCandidate: vi.fn().mockResolvedValue({
        id: mediaId,
        owner_id: ownerId,
        relative_path: `${ownerId}/2026/02/${mediaId}.jpg`,
        deleted_soft: false
      }),
      hardDeleteMediaGraphIfStillSoftDeleted: vi.fn()
    };

    const processor = createMediaCleanupProcessor({
      originalsRoot,
      derivedRoot,
      mediaRepo,
      logger: {
        info() {},
        warn() {},
        error() {}
      }
    });

    const result = await processor({
      id: "cleanup-job-2",
      queueName: "media.cleanup",
      data: { mediaId, ownerId }
    });

    expect(result).toEqual({ mediaId, status: "restored-skip" });
    expect(mediaRepo.hardDeleteMediaGraphIfStillSoftDeleted).not.toHaveBeenCalled();
  });

  it("tolerates missing files while still hard-deleting rows", async () => {
    const mediaId = "f95a95b0-a57b-4d99-89c6-95ccbe3ab2e9";
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const relativePath = `${ownerId}/2026/02/${mediaId}.jpg`;

    const mediaRepo = {
      acquireProcessingLock: vi.fn().mockResolvedValue({
        acquired: true,
        mediaId,
        client: { query: vi.fn() },
        shouldReleaseClient: false
      }),
      releaseProcessingLock: vi.fn().mockResolvedValue(undefined),
      findCleanupCandidate: vi.fn().mockResolvedValue({
        id: mediaId,
        owner_id: ownerId,
        relative_path: relativePath,
        deleted_soft: true
      }),
      hardDeleteMediaGraphIfStillSoftDeleted: vi.fn().mockResolvedValue({ deleted: true })
    };

    const processor = createMediaCleanupProcessor({
      originalsRoot,
      derivedRoot,
      mediaRepo,
      logger: {
        info() {},
        warn() {},
        error() {}
      }
    });

    const result = await processor({
      id: "cleanup-job-3",
      queueName: "media.cleanup",
      data: { mediaId, ownerId }
    });

    expect(result).toEqual({ mediaId, status: "deleted" });
    expect(mediaRepo.hardDeleteMediaGraphIfStillSoftDeleted).toHaveBeenCalledWith(mediaId, ownerId);
  });
});
