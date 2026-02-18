const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { buildApp } = require("../../src/app");

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://photox:photox-dev-password@127.0.0.1:5432/photox";

function jsonBody(response) {
  return JSON.parse(response.body);
}

function makePseudoJpeg(size = 64) {
  const minSize = Math.max(size, 8);
  const buffer = Buffer.alloc(minSize, 0x00);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[minSize - 2] = 0xff;
  buffer[minSize - 1] = 0xd9;
  return buffer;
}

function createAccessToken({ userId, email, secret }) {
  return jwt.sign(
    {
      type: "access",
      email
    },
    secret,
    {
      subject: userId,
      expiresIn: 300
    }
  );
}

async function listRelativeFiles(rootPath, currentPath = ".") {
  const entries = await fs.readdir(path.join(rootPath, currentPath), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const nextPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listRelativeFiles(rootPath, nextPath)));
      continue;
    }

    files.push(nextPath.split(path.sep).join("/"));
  }

  return files;
}

describe("upload init integration", () => {
  let app;
  const accessSecret = "ingest-integration-access-secret";
  const testUploadsRoot = path.join(os.tmpdir(), "photox-ingest-tests");
  const queuedJobs = [];
  const queueStub = {
    add: async (...args) => {
      queuedJobs.push(args);
    }
  };

  beforeAll(async () => {
    app = buildApp({
      databaseUrl: TEST_DATABASE_URL,
      jwtAccessSecret: accessSecret,
      serviceName: "ingest-service-test",
      uploadPartSizeBytes: 5 * 1024 * 1024,
      uploadOriginalsPath: testUploadsRoot,
      mediaProcessQueue: queueStub
    });
    await app.ready();
  });

  beforeEach(async () => {
    await app.db.query(
      "TRUNCATE TABLE upload_parts, idempotency_keys, media_flags, media, upload_sessions RESTART IDENTITY CASCADE"
    );
    await fs.rm(testUploadsRoot, { recursive: true, force: true });
    await fs.mkdir(testUploadsRoot, { recursive: true });
    queuedJobs.length = 0;
  });

  afterAll(async () => {
    await app.close();
    await fs.rm(testUploadsRoot, { recursive: true, force: true });
  });

  it("initializes upload session and returns metadata", async () => {
    const accessToken = createAccessToken({
      userId: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      secret: accessSecret
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": "idem-init-1"
      },
      payload: {
        fileName: "IMG_1024.jpg",
        contentType: "image/jpeg",
        fileSize: 1200,
        checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
      }
    });

    expect(response.statusCode).toBe(201);
    const body = jsonBody(response);
    expect(body.uploadId).toBeTruthy();
    expect(body.partSize).toBe(5 * 1024 * 1024);
    expect(body.expiresAt).toBeTruthy();
  });

  it("rejects unsupported media type declarations during init", async () => {
    const accessToken = createAccessToken({
      userId: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      secret: accessSecret
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        fileName: "payload.pdf",
        contentType: "application/pdf",
        fileSize: 1200,
        checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(jsonBody(response).error.code).toBe("VALIDATION_ERROR");
  });

  it("replays upload init response for same idempotency key", async () => {
    const accessToken = createAccessToken({
      userId: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      secret: accessSecret
    });

    const payload = {
      fileName: "IMG_1024.jpg",
      contentType: "image/jpeg",
      fileSize: 1200,
      checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": "idem-init-1"
      },
      payload
    });

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": "idem-init-1"
      },
      payload
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(jsonBody(first)).toEqual(jsonBody(second));
  });

  it("rejects idempotency key reuse with different payload", async () => {
    const accessToken = createAccessToken({
      userId: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      secret: accessSecret
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": "idem-init-1"
      },
      payload: {
        fileName: "IMG_1024.jpg",
        contentType: "image/jpeg",
        fileSize: 1200,
        checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
      }
    });

    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": "idem-init-1"
      },
      payload: {
        fileName: "IMG_1025.jpg",
        contentType: "image/jpeg",
        fileSize: 1200,
        checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
      }
    });

    expect(conflict.statusCode).toBe(409);
    expect(jsonBody(conflict).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("uploads part bytes and reports upload status", async () => {
    const accessToken = createAccessToken({
      userId: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      secret: accessSecret
    });

    const init = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        fileName: "IMG_2000.jpg",
        contentType: "image/jpeg",
        fileSize: 12,
        checksumSha256: "7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9"
      }
    });

    const initBody = jsonBody(init);
    const chunk = makePseudoJpeg(128);
    const uploadPart = await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${initBody.uploadId}/part?partNumber=1`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/octet-stream"
      },
      payload: chunk
    });

    expect(uploadPart.statusCode).toBe(200);
    expect(jsonBody(uploadPart).bytesStored).toBe(chunk.length);

    const status = await app.inject({
      method: "GET",
      url: `/api/v1/uploads/${initBody.uploadId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(status.statusCode).toBe(200);
    const statusBody = jsonBody(status);
    expect(statusBody.status).toBe("uploading");
    expect(statusBody.uploadedBytes).toBe(chunk.length);
    expect(statusBody.uploadedParts).toEqual([1]);
  });

  it("completes upload, creates media record, and enqueues processing job", async () => {
    const accessToken = createAccessToken({
      userId: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      secret: accessSecret
    });

    const chunk = makePseudoJpeg(128);
    const fileChecksum = crypto.createHash("sha256").update(chunk).digest("hex");

    const init = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        fileName: "IMG_3000.jpg",
        contentType: "image/jpeg",
        fileSize: chunk.length,
        checksumSha256: fileChecksum
      }
    });

    const uploadId = jsonBody(init).uploadId;

    await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${uploadId}/part?partNumber=1`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/octet-stream"
      },
      payload: chunk
    });

    const complete = await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${uploadId}/complete`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": "idem-complete-1"
      },
      payload: {
        checksumSha256: fileChecksum
      }
    });

    expect(complete.statusCode).toBe(200);
    const completeBody = jsonBody(complete);
    expect(completeBody.mediaId).toBeTruthy();
    expect(completeBody.status).toBe("processing");
    expect(completeBody.deduplicated).toBe(false);
    expect(queuedJobs.length).toBe(1);
    expect(queuedJobs[0][0]).toBe("media.process");

    const mediaRow = await app.db.query("SELECT relative_path, status FROM media WHERE id = $1", [
      completeBody.mediaId
    ]);
    expect(mediaRow.rowCount).toBe(1);
    expect(mediaRow.rows[0].relative_path.includes("0f3c9d30-1307-4c9e-a4d7-75e84606c28d/")).toBe(true);
    expect(mediaRow.rows[0].status).toBe("processing");
  });

  it("aborts upload session and marks status as aborted", async () => {
    const accessToken = createAccessToken({
      userId: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      secret: accessSecret
    });

    const init = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        fileName: "IMG_abort.jpg",
        contentType: "image/jpeg",
        fileSize: 3,
        checksumSha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
      }
    });

    const uploadId = jsonBody(init).uploadId;
    const abort = await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${uploadId}/abort`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(abort.statusCode).toBe(200);
    expect(jsonBody(abort)).toEqual({
      uploadId,
      status: "aborted"
    });

    const status = await app.inject({
      method: "GET",
      url: `/api/v1/uploads/${uploadId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(status.statusCode).toBe(200);
    expect(jsonBody(status).status).toBe("aborted");
  });

  it("replays complete response for same idempotency key", async () => {
    const accessToken = createAccessToken({
      userId: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      secret: accessSecret
    });

    const chunk = makePseudoJpeg(192);
    const fileChecksum = crypto.createHash("sha256").update(chunk).digest("hex");

    const init = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        fileName: "idem-complete.jpg",
        contentType: "image/jpeg",
        fileSize: chunk.length,
        checksumSha256: fileChecksum
      }
    });
    const uploadId = jsonBody(init).uploadId;

    await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${uploadId}/part?partNumber=1`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/octet-stream"
      },
      payload: chunk
    });

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${uploadId}/complete`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": "idem-complete-replay-1"
      },
      payload: {
        checksumSha256: fileChecksum
      }
    });

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${uploadId}/complete`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": "idem-complete-replay-1"
      },
      payload: {
        checksumSha256: fileChecksum
      }
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(jsonBody(first)).toEqual(jsonBody(second));
  });

  it("supports chunked upload for files larger than 25MB", async () => {
    const accessToken = createAccessToken({
      userId: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      secret: accessSecret
    });

    const totalBytes = 26 * 1024 * 1024;
    const fullFile = makePseudoJpeg(totalBytes);
    const fileChecksum = crypto.createHash("sha256").update(fullFile).digest("hex");
    const partSize = 5 * 1024 * 1024;

    const init = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        fileName: "large-upload.jpg",
        contentType: "image/jpeg",
        fileSize: totalBytes,
        checksumSha256: fileChecksum
      }
    });

    expect(init.statusCode).toBe(201);
    const uploadId = jsonBody(init).uploadId;

    let partNumber = 1;
    for (let offset = 0; offset < totalBytes; offset += partSize) {
      const payload = fullFile.subarray(offset, Math.min(offset + partSize, totalBytes));
      const partResponse = await app.inject({
        method: "POST",
        url: `/api/v1/uploads/${uploadId}/part?partNumber=${partNumber}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/octet-stream"
        },
        payload
      });
      expect(partResponse.statusCode).toBe(200);
      partNumber += 1;
    }

    const complete = await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${uploadId}/complete`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        checksumSha256: fileChecksum
      }
    });

    expect(complete.statusCode).toBe(200);
    expect(jsonBody(complete).status).toBe("processing");
    expect(jsonBody(complete).deduplicated).toBe(false);
  });

  it("cleans staged assembled file on checksum mismatch", async () => {
    const accessToken = createAccessToken({
      userId: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      secret: accessSecret
    });

    const chunk = makePseudoJpeg(96);
    const fileChecksum = crypto.createHash("sha256").update(chunk).digest("hex");

    const init = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        fileName: "mismatch.jpg",
        contentType: "image/jpeg",
        fileSize: chunk.length,
        checksumSha256: fileChecksum
      }
    });
    const uploadId = jsonBody(init).uploadId;

    await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${uploadId}/part?partNumber=1`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/octet-stream"
      },
      payload: chunk
    });

    const complete = await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${uploadId}/complete`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    });

    expect(complete.statusCode).toBe(409);
    expect(jsonBody(complete).error.code).toBe("UPLOAD_CHECKSUM_MISMATCH");

    const files = await listRelativeFiles(testUploadsRoot);
    const hasStagedAssembledFile = files.some((filePath) =>
      filePath.startsWith("0f3c9d30-1307-4c9e-a4d7-75e84606c28d/")
    );
    expect(hasStagedAssembledFile).toBe(false);
  });

  it("rejects completion when detected media type mismatches declaration", async () => {
    const accessToken = createAccessToken({
      userId: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      secret: accessSecret
    });

    const fakeMp4Chunk = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x20]),
      Buffer.from("ftypisom", "ascii"),
      Buffer.alloc(32, 0x00)
    ]);
    const fileChecksum = crypto.createHash("sha256").update(fakeMp4Chunk).digest("hex");

    const init = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        fileName: "not-really-photo.jpg",
        contentType: "image/jpeg",
        fileSize: fakeMp4Chunk.length,
        checksumSha256: fileChecksum
      }
    });

    expect(init.statusCode).toBe(201);
    const uploadId = jsonBody(init).uploadId;

    await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${uploadId}/part?partNumber=1`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/octet-stream"
      },
      payload: fakeMp4Chunk
    });

    const complete = await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${uploadId}/complete`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        checksumSha256: fileChecksum
      }
    });

    expect(complete.statusCode).toBe(415);
    expect(jsonBody(complete).error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("handles concurrent complete requests with same idempotency key safely", async () => {
    const accessToken = createAccessToken({
      userId: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      secret: accessSecret
    });

    const chunk = makePseudoJpeg(160);
    const fileChecksum = crypto.createHash("sha256").update(chunk).digest("hex");

    const init = await app.inject({
      method: "POST",
      url: "/api/v1/uploads/init",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        fileName: "concurrent-idem.jpg",
        contentType: "image/jpeg",
        fileSize: chunk.length,
        checksumSha256: fileChecksum
      }
    });
    const uploadId = jsonBody(init).uploadId;

    await app.inject({
      method: "POST",
      url: `/api/v1/uploads/${uploadId}/part?partNumber=1`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/octet-stream"
      },
      payload: chunk
    });

    const [firstComplete, secondComplete] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/v1/uploads/${uploadId}/complete`,
        headers: {
          authorization: `Bearer ${accessToken}`,
          "idempotency-key": "idem-concurrent-complete-1"
        },
        payload: {
          checksumSha256: fileChecksum
        }
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/uploads/${uploadId}/complete`,
        headers: {
          authorization: `Bearer ${accessToken}`,
          "idempotency-key": "idem-concurrent-complete-1"
        },
        payload: {
          checksumSha256: fileChecksum
        }
      })
    ]);

    expect(firstComplete.statusCode).toBe(200);
    expect(secondComplete.statusCode).toBe(200);
    expect(jsonBody(firstComplete)).toEqual(jsonBody(secondComplete));

    const mediaCount = await app.db.query(
      "SELECT COUNT(*)::INTEGER AS count FROM media WHERE owner_id = $1 AND checksum_sha256 = $2",
      ["0f3c9d30-1307-4c9e-a4d7-75e84606c28d", fileChecksum]
    );
    expect(mediaCount.rows[0].count).toBe(1);

    const idemCount = await app.db.query(
      "SELECT COUNT(*)::INTEGER AS count FROM idempotency_keys WHERE user_id = $1 AND scope = $2 AND idem_key = $3",
      ["0f3c9d30-1307-4c9e-a4d7-75e84606c28d", "upload_complete", "idem-concurrent-complete-1"]
    );
    expect(idemCount.rows[0].count).toBe(1);
    expect(queuedJobs.length).toBe(1);
  });

  it("deduplicates repeated upload by owner and checksum when existing media is active", async () => {
    const accessToken = createAccessToken({
      userId: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      secret: accessSecret
    });

    const chunk = makePseudoJpeg(128);
    const fileChecksum = crypto.createHash("sha256").update(chunk).digest("hex");

    async function createUploadAndComplete(fileName) {
      const init = await app.inject({
        method: "POST",
        url: "/api/v1/uploads/init",
        headers: {
          authorization: `Bearer ${accessToken}`
        },
        payload: {
          fileName,
          contentType: "image/jpeg",
          fileSize: chunk.length,
          checksumSha256: fileChecksum
        }
      });

      const uploadId = jsonBody(init).uploadId;

      await app.inject({
        method: "POST",
        url: `/api/v1/uploads/${uploadId}/part?partNumber=1`,
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/octet-stream"
        },
        payload: chunk
      });

      return app.inject({
        method: "POST",
        url: `/api/v1/uploads/${uploadId}/complete`,
        headers: {
          authorization: `Bearer ${accessToken}`
        },
        payload: {
          checksumSha256: fileChecksum
        }
      });
    }

    const firstComplete = await createUploadAndComplete("duplicate-1.jpg");
    const firstBody = jsonBody(firstComplete);
    expect(firstComplete.statusCode).toBe(200);
    expect(firstBody.deduplicated).toBe(false);

    const secondComplete = await createUploadAndComplete("duplicate-2.jpg");
    const secondBody = jsonBody(secondComplete);
    expect(secondComplete.statusCode).toBe(200);
    expect(secondBody.mediaId).toBe(firstBody.mediaId);
    expect(secondBody.deduplicated).toBe(true);

    const mediaCount = await app.db.query(
      "SELECT COUNT(*)::INTEGER AS count FROM media WHERE owner_id = $1 AND checksum_sha256 = $2",
      ["0f3c9d30-1307-4c9e-a4d7-75e84606c28d", fileChecksum]
    );
    expect(mediaCount.rows[0].count).toBe(1);
    expect(queuedJobs.length).toBe(1);
  });

  it("ignores soft-deleted media during dedupe and creates new media", async () => {
    const accessToken = createAccessToken({
      userId: "0f3c9d30-1307-4c9e-a4d7-75e84606c28d",
      email: "user@example.com",
      secret: accessSecret
    });

    const chunk = makePseudoJpeg(144);
    const fileChecksum = crypto.createHash("sha256").update(chunk).digest("hex");

    async function createUploadAndComplete(fileName) {
      const init = await app.inject({
        method: "POST",
        url: "/api/v1/uploads/init",
        headers: {
          authorization: `Bearer ${accessToken}`
        },
        payload: {
          fileName,
          contentType: "image/jpeg",
          fileSize: chunk.length,
          checksumSha256: fileChecksum
        }
      });

      const uploadId = jsonBody(init).uploadId;

      await app.inject({
        method: "POST",
        url: `/api/v1/uploads/${uploadId}/part?partNumber=1`,
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/octet-stream"
        },
        payload: chunk
      });

      return app.inject({
        method: "POST",
        url: `/api/v1/uploads/${uploadId}/complete`,
        headers: {
          authorization: `Bearer ${accessToken}`
        },
        payload: {
          checksumSha256: fileChecksum
        }
      });
    }

    const firstComplete = await createUploadAndComplete("soft-deleted-1.jpg");
    const firstBody = jsonBody(firstComplete);
    expect(firstComplete.statusCode).toBe(200);
    expect(firstBody.deduplicated).toBe(false);

    await app.db.query(
      `
        INSERT INTO media_flags (media_id, deleted_soft)
        VALUES ($1, true)
        ON CONFLICT (media_id)
        DO UPDATE SET deleted_soft = true, updated_at = NOW()
      `,
      [firstBody.mediaId]
    );

    const secondComplete = await createUploadAndComplete("soft-deleted-2.jpg");
    const secondBody = jsonBody(secondComplete);
    expect(secondComplete.statusCode).toBe(200);
    expect(secondBody.mediaId).not.toBe(firstBody.mediaId);
    expect(secondBody.deduplicated).toBe(false);

    const mediaCount = await app.db.query(
      "SELECT COUNT(*)::INTEGER AS count FROM media WHERE owner_id = $1 AND checksum_sha256 = $2",
      ["0f3c9d30-1307-4c9e-a4d7-75e84606c28d", fileChecksum]
    );
    expect(mediaCount.rows[0].count).toBe(2);
    expect(queuedJobs.length).toBe(2);
  });

  it("exposes OpenAPI and Swagger docs with idempotency headers", async () => {
    const openapi = await app.inject({
      method: "GET",
      url: "/api/v1/uploads/openapi.json"
    });

    expect(openapi.statusCode).toBe(200);
    const spec = jsonBody(openapi);
    expect(spec.openapi).toBeTruthy();

    const initPost = spec.paths["/api/v1/uploads/init"].post;
    const completePost = spec.paths["/api/v1/uploads/{uploadId}/complete"].post;
    expect(initPost.summary).toBeTruthy();
    expect(initPost.description).toBeTruthy();
    expect(completePost.summary).toBeTruthy();
    expect(completePost.description).toBeTruthy();

    expect(initPost.description).toContain("Idempotency-Key");
    expect(completePost.description).toContain("Idempotency-Key");
    expect(initPost.security[0].bearerAuth).toEqual([]);
    expect(completePost.security[0].bearerAuth).toEqual([]);

    const docs = await app.inject({
      method: "GET",
      url: "/api/v1/uploads/docs"
    });
    expect(docs.statusCode).toBe(200);
    expect(docs.headers["content-type"]).toContain("text/html");
  });
});
