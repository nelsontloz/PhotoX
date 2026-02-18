const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const sharp = require("sharp");
const {
  acquireProcessingLockWithRetry,
  createMediaDerivativesProcessor,
  isTerminalFailure,
  ProcessingLockUnavailableError,
  persistFailedStatusOnTerminalFailure
} = require("../../src/queues/mediaDerivativesWorker");

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
      warn() {},
      error() {}
    };

    const mediaRepo = {
      acquireProcessingLock: vi.fn().mockResolvedValue({
        acquired: true,
        mediaId,
        client: { query: vi.fn() },
        shouldReleaseClient: false
      }),
      releaseProcessingLock: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn().mockResolvedValue({
        id: mediaId,
        mime_type: "image/jpeg",
        created_at: "2026-02-18T00:00:00.000Z"
      }),
      upsertMetadata: vi.fn().mockResolvedValue({ media_id: mediaId }),
      setReadyIfProcessing: vi.fn().mockResolvedValue({ id: mediaId, status: "ready" })
    };

    const commandRunner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        format: {
          tags: {
            DateTimeOriginal: "2026:02:17 10:00:00",
            Make: "Canon",
            Model: "EOS"
          }
        },
        streams: []
      }),
      stderr: ""
    });

    const processor = createMediaDerivativesProcessor({
      originalsRoot,
      derivedRoot,
      mediaRepo,
      commandRunner,
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
    expect(mediaRepo.acquireProcessingLock).toHaveBeenCalledWith(mediaId, { tryOnly: true });
    expect(mediaRepo.upsertMetadata).toHaveBeenCalled();
    expect(mediaRepo.setReadyIfProcessing).toHaveBeenCalledWith(mediaId);
    expect(mediaRepo.releaseProcessingLock).toHaveBeenCalledWith(
      expect.objectContaining({ acquired: true, mediaId })
    );

    const thumbPath = path.join(derivedRoot, ownerId, "2026", "02", `${mediaId}-thumb.webp`);
    const smallPath = path.join(derivedRoot, ownerId, "2026", "02", `${mediaId}-small.webp`);
    await expect(fs.stat(thumbPath)).resolves.toBeTruthy();
    await expect(fs.stat(smallPath)).resolves.toBeTruthy();
  });

  it("writes video thumb, small, and playback webm derivatives", async () => {
    const mediaId = "dbf242a8-59e8-4e46-b6a0-d7ec247ca4f7";
    const ownerId = "f446dc45-1564-4f79-99a4-c7c17ce9e16f";
    const relativePath = `${ownerId}/2026/02/${mediaId}.mp4`;
    const sourceAbsolutePath = path.join(originalsRoot, ownerId, "2026", "02", `${mediaId}.mp4`);

    await fs.mkdir(path.dirname(sourceAbsolutePath), { recursive: true });
    await fs.writeFile(sourceAbsolutePath, "video-source-placeholder");

    const execFileMock = vi.fn((command, args, options, callback) => {
      const done = typeof options === "function" ? options : callback;

      if (command === "ffprobe") {
        done(null, JSON.stringify({ streams: [{ codec_type: "video" }] }), "");
        return;
      }

      if (command === "ffmpeg") {
        const outputPath = args.at(-1);
        fs.mkdir(path.dirname(outputPath), { recursive: true })
          .then(() => fs.writeFile(outputPath, `generated-${path.basename(outputPath)}`))
          .then(() => done(null, "", ""))
          .catch((err) => done(err));
        return;
      }

      done(new Error(`Unexpected command: ${command}`));
    });

    const mediaRepo = {
      acquireProcessingLock: vi.fn().mockResolvedValue({
        acquired: true,
        mediaId,
        client: { query: vi.fn() },
        shouldReleaseClient: false
      }),
      releaseProcessingLock: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn().mockResolvedValue({
        id: mediaId,
        mime_type: "video/mp4",
        created_at: "2026-02-18T00:00:00.000Z"
      }),
      upsertMetadata: vi.fn().mockResolvedValue({ media_id: mediaId }),
      setReadyIfProcessing: vi.fn().mockResolvedValue({ id: mediaId, status: "ready" })
    };

    const processor = createMediaDerivativesProcessor({
      originalsRoot,
      derivedRoot,
      mediaRepo,
      commandRunner: (command, args) =>
        new Promise((resolve, reject) => {
          execFileMock(command, args, (err, stdout, stderr) => {
            if (err) {
              reject(err);
              return;
            }
            resolve({ stdout: stdout || "", stderr: stderr || "" });
          });
        }),
      logger: {
        info() {},
        warn() {},
        error() {}
      }
    });

    const result = await processor({
      id: "job-2",
      queueName: "media.derivatives.generate",
      data: {
        mediaId,
        relativePath
      }
    });

    expect(result.mediaId).toBe(mediaId);
    expect(result.derivatives).toHaveLength(3);
    expect(result.derivatives.map((derivative) => derivative.variant)).toEqual(["thumb", "small", "playback"]);
    expect(mediaRepo.acquireProcessingLock).toHaveBeenCalledWith(mediaId, { tryOnly: true });
    expect(mediaRepo.upsertMetadata).toHaveBeenCalled();
    expect(mediaRepo.setReadyIfProcessing).toHaveBeenCalledWith(mediaId);
    expect(mediaRepo.releaseProcessingLock).toHaveBeenCalledWith(
      expect.objectContaining({ acquired: true, mediaId })
    );

    const thumbPath = path.join(derivedRoot, ownerId, "2026", "02", `${mediaId}-thumb.webp`);
    const smallPath = path.join(derivedRoot, ownerId, "2026", "02", `${mediaId}-small.webp`);
    const playbackPath = path.join(derivedRoot, ownerId, "2026", "02", `${mediaId}-playback.webm`);

    await expect(fs.stat(thumbPath)).resolves.toBeTruthy();
    await expect(fs.stat(smallPath)).resolves.toBeTruthy();
    await expect(fs.stat(playbackPath)).resolves.toBeTruthy();

    expect(execFileMock).toHaveBeenCalled();
  });

  it("rejects invalid payloads", async () => {
    const processor = createMediaDerivativesProcessor({
      originalsRoot,
      derivedRoot,
      logger: {
        info() {},
        warn() {},
        error() {}
      }
    });

    await expect(
      processor({
        id: "job-3",
        queueName: "media.derivatives.generate",
        data: {
          mediaId: "missing-path"
        }
      })
    ).rejects.toThrow("Invalid derivatives job payload");
  });

  it("retries lock acquisition with bounded backoff", async () => {
    const mediaRepo = {
      acquireProcessingLock: vi
        .fn()
        .mockResolvedValueOnce({ acquired: false, mediaId: "m-lock" })
        .mockResolvedValueOnce({ acquired: false, mediaId: "m-lock" })
        .mockResolvedValueOnce({
          acquired: true,
          mediaId: "m-lock",
          client: { query: vi.fn() },
          shouldReleaseClient: false
        })
    };

    const logger = {
      warn: vi.fn()
    };

    const lockHandle = await acquireProcessingLockWithRetry({
      mediaRepo,
      mediaId: "m-lock",
      logger,
      queueName: "media.derivatives.generate",
      jobId: "job-lock",
      retryAttempts: 3,
      retryDelayMs: 1
    });

    expect(lockHandle).toEqual(expect.objectContaining({ acquired: true, mediaId: "m-lock" }));
    expect(mediaRepo.acquireProcessingLock).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("throws retriable error when lock acquisition stays contended", async () => {
    const mediaId = "m-contended";
    const mediaRepo = {
      acquireProcessingLock: vi.fn().mockResolvedValue({ acquired: false, mediaId }),
      releaseProcessingLock: vi.fn(),
      findById: vi.fn(),
      upsertMetadata: vi.fn(),
      setReadyIfProcessing: vi.fn()
    };

    const processor = createMediaDerivativesProcessor({
      originalsRoot,
      derivedRoot,
      mediaRepo,
      logger: {
        info() {},
        warn() {},
        error() {}
      }
    });

    await expect(
      processor({
        id: "job-lock-fail",
        queueName: "media.derivatives.generate",
        data: {
          mediaId,
          relativePath: "owner/2026/02/file.jpg",
          lockRetryAttempts: 2,
          lockRetryDelayMs: 1
        }
      })
    ).rejects.toBeInstanceOf(ProcessingLockUnavailableError);

    expect(mediaRepo.acquireProcessingLock).toHaveBeenCalledTimes(2);
    expect(mediaRepo.findById).not.toHaveBeenCalled();
    expect(mediaRepo.setReadyIfProcessing).not.toHaveBeenCalled();
    expect(mediaRepo.releaseProcessingLock).not.toHaveBeenCalled();
  });

  it("detects terminal failure only when attempts are exhausted", () => {
    expect(
      isTerminalFailure({
        attemptsMade: 1,
        opts: { attempts: 3 }
      })
    ).toBe(false);

    expect(
      isTerminalFailure({
        attemptsMade: 3,
        opts: { attempts: 3 }
      })
    ).toBe(true);
  });

  it("persists failed status for terminal job failures", async () => {
    const mediaRepo = {
      setFailedIfProcessing: vi.fn().mockResolvedValue({ id: "m1", status: "failed" })
    };
    const logger = {
      error: vi.fn()
    };

    await persistFailedStatusOnTerminalFailure({
      job: {
        id: "job-final",
        attemptsMade: 5,
        opts: { attempts: 5 },
        data: { mediaId: "m1" }
      },
      mediaRepo,
      logger,
      queueName: "media.derivatives.generate"
    });

    expect(mediaRepo.setFailedIfProcessing).toHaveBeenCalledWith("m1");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not persist failed status for non-terminal failures", async () => {
    const mediaRepo = {
      setFailedIfProcessing: vi.fn()
    };

    await persistFailedStatusOnTerminalFailure({
      job: {
        id: "job-retry",
        attemptsMade: 2,
        opts: { attempts: 5 },
        data: { mediaId: "m1" }
      },
      mediaRepo,
      logger: {
        error: vi.fn()
      },
      queueName: "media.derivatives.generate"
    });

    expect(mediaRepo.setFailedIfProcessing).not.toHaveBeenCalled();
  });
});
