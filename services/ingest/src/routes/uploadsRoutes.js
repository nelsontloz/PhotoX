const crypto = require("node:crypto");
const fs = require("node:fs/promises");

const { requireAccessAuth, requireCsrfForCookieAuth } = require("../auth/guard");
const { ApiError } = require("../errors");
const {
  completeUploadSchema,
  initUploadSchema,
  parseOrThrow,
  uploadPartQuerySchema,
  uploadPathParamsSchema
} = require("../validation");
const {
  assemblePartsToFile,
  buildMediaRelativePath,
  checksumFileSha256,
  checksumSha256,
  removeUploadTempDir,
  writeUploadPart,
  writeUploadPartStream
} = require("../upload/storage");
const {
  detectSupportedMimeTypeFromFile,
  getFileExtension,
  isSupportedDeclaredMediaType,
  normalizeContentType
} = require("../upload/mediaTypePolicy");
const { buildMediaProcessMessage } = require("../contracts/mediaProcessMessage");

const IDEMPOTENCY_SCOPE_UPLOAD_INIT = "upload_init";
const IDEMPOTENCY_SCOPE_UPLOAD_COMPLETE = "upload_complete";

function hashPayload(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function buildInitResponse(session) {
  return {
    uploadId: session.id,
    partSize: session.part_size,
    expiresAt: new Date(session.expires_at).toISOString()
  };
}

function buildPartResponse(part, uploadId) {
  return {
    uploadId,
    partNumber: part.part_number,
    bytesStored: part.byte_size,
    checksumSha256: part.checksum_sha256
  };
}

function buildStatusResponse({ session, uploadedBytes, uploadedParts }) {
  return {
    uploadId: session.id,
    status: session.status,
    fileSize: Number(session.file_size),
    partSize: session.part_size,
    uploadedBytes,
    uploadedParts,
    expiresAt: new Date(session.expires_at).toISOString()
  };
}

function buildCompleteResponse(mediaId, deduplicated = false) {
  return {
    mediaId,
    status: "processing",
    deduplicated
  };
}

function readIdempotencyKey(headers) {
  const idempotencyKey = headers["idempotency-key"];
  if (!idempotencyKey) {
    return null;
  }

  if (typeof idempotencyKey !== "string") {
    throw new ApiError(400, "VALIDATION_ERROR", "Idempotency key must be a string");
  }

  return idempotencyKey;
}

function ensureUploadSessionExists(session) {
  if (!session) {
    throw new ApiError(404, "UPLOAD_NOT_FOUND", "Upload session not found");
  }
}

function assertMatchingIdempotencyHash(existing, requestHash) {
  if (existing.request_hash !== requestHash) {
    throw new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was already used with a different request"
    );
  }
}

async function persistIdempotencyResult({ app, userId, scope, idemKey, requestHash, responseBody, statusCode }) {
  const stored = await app.repos.idempotency.insertOrGetExisting({
    userId,
    scope,
    idemKey,
    requestHash,
    responseBody,
    statusCode
  });

  if (!stored) {
    throw new Error("Failed to persist idempotency response");
  }

  assertMatchingIdempotencyHash(stored.record, requestHash);
  return {
    statusCode: stored.record.status_code,
    responseBody: stored.record.response_body
  };
}

function buildErrorEnvelopeSchema(code, message, details = {}) {
  return {
    type: "object",
    required: ["error", "requestId"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "details"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          details: {
            type: "object",
            additionalProperties: true
          }
        }
      },
      requestId: { type: "string" }
    },
    example: {
      error: {
        code,
        message,
        details
      },
      requestId: "req-4xYdA1GspM9n"
    }
  };
}

module.exports = async function uploadsRoutes(app) {
  const accessGuard = requireAccessAuth(app.config);
  const csrfGuard = requireCsrfForCookieAuth();

  const writeGuards = async (request) => {
    await accessGuard(request);
    await csrfGuard(request);
  };

  app.post(
    "/api/v1/uploads/init",
    {
      preHandler: writeGuards,
      schema: {
        tags: ["Uploads"],
        summary: "Initialize upload session",
        description:
          "Create an upload session and return chunk size metadata for resumable part uploads. Supports Idempotency-Key for safe retries.",
        security: [{ bearerAuth: [] }],
        headers: {
          type: "object",
          properties: {
            "idempotency-key": {
              type: "string",
              minLength: 1,
              description: "Optional key to safely retry upload initialization without creating duplicate sessions."
            }
          },
          additionalProperties: true
        },
        body: {
          type: "object",
          required: ["fileName", "contentType", "fileSize", "checksumSha256"],
          properties: {
            fileName: { type: "string", minLength: 1, maxLength: 255 },
            contentType: { type: "string", minLength: 1, maxLength: 120 },
            fileSize: { type: "integer", minimum: 1 },
            checksumSha256: { type: "string", pattern: "^[a-fA-F0-9]{64}$" }
          },
          additionalProperties: false,
          example: {
            fileName: "IMG_1024.jpg",
            contentType: "image/jpeg",
            fileSize: 3811212,
            checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
          }
        },
        response: {
          201: {
            type: "object",
            required: ["uploadId", "partSize", "expiresAt"],
            properties: {
              uploadId: { type: "string", format: "uuid" },
              partSize: { type: "integer", minimum: 1 },
              expiresAt: { type: "string", format: "date-time" }
            },
            example: {
              uploadId: "30e71f52-775f-4a2f-a25d-aed8a48ac5d8",
              partSize: 5242880,
              expiresAt: "2026-02-15T18:00:00.000Z"
            }
          },
          400: buildErrorEnvelopeSchema("VALIDATION_ERROR", "Request validation failed"),
          415: buildErrorEnvelopeSchema("UNSUPPORTED_MEDIA_TYPE", "Unsupported or mismatched media type"),
          401: buildErrorEnvelopeSchema("AUTH_TOKEN_INVALID", "Missing bearer token"),
          409: buildErrorEnvelopeSchema(
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key was already used with a different request"
          )
        }
      }
    },
    async (request, reply) => {
      const body = parseOrThrow(initUploadSchema, request.body || {});
      const userId = request.userAuth.userId;

      if (
        !isSupportedDeclaredMediaType({
          fileName: body.fileName,
          contentType: body.contentType
        })
      ) {
        throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported or mismatched media type", {
          fileName: body.fileName,
          contentType: body.contentType
        });
      }

      const idempotencyKey = readIdempotencyKey(request.headers);

      const requestHash = hashPayload(body);
      if (idempotencyKey) {
        const existing = await app.repos.idempotency.find(userId, IDEMPOTENCY_SCOPE_UPLOAD_INIT, idempotencyKey);
        if (existing) {
          assertMatchingIdempotencyHash(existing, requestHash);

          reply.code(existing.status_code).send(existing.response_body);
          return;
        }
      }

      const expiresAt = new Date(Date.now() + app.config.uploadTtlSeconds * 1000);
      const session = await app.repos.uploadSessions.create({
        userId,
        fileName: body.fileName,
        contentType: body.contentType,
        fileSize: body.fileSize,
        checksumSha256: body.checksumSha256,
        partSize: app.config.uploadPartSizeBytes,
        expiresAt
      });

      const responseBody = buildInitResponse(session);
      if (idempotencyKey) {
        const persisted = await persistIdempotencyResult({
          app,
          userId,
          scope: IDEMPOTENCY_SCOPE_UPLOAD_INIT,
          idemKey: idempotencyKey,
          requestHash,
          responseBody,
          statusCode: 201
        });

        reply.code(persisted.statusCode).send(persisted.responseBody);
        return;
      }

      reply.code(201).send(responseBody);
    }
  );

  app.post(
    "/api/v1/uploads/:uploadId/part",
    {
      preHandler: writeGuards,
      schema: {
        tags: ["Uploads"],
        summary: "Upload chunk part",
        description: "Upload a single binary chunk part for an existing upload session.",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["uploadId"],
          properties: {
            uploadId: { type: "string", format: "uuid" }
          }
        },
        querystring: {
          type: "object",
          required: ["partNumber"],
          properties: {
            partNumber: { type: "string", pattern: "^\\d+$" }
          }
        },
        response: {
          200: {
            type: "object",
            required: ["uploadId", "partNumber", "bytesStored", "checksumSha256"],
            properties: {
              uploadId: { type: "string", format: "uuid" },
              partNumber: { type: "integer", minimum: 1 },
              bytesStored: { type: "integer", minimum: 1 },
              checksumSha256: { type: "string", pattern: "^[a-fA-F0-9]{64}$" }
            },
            example: {
              uploadId: "30e71f52-775f-4a2f-a25d-aed8a48ac5d8",
              partNumber: 1,
              bytesStored: 5242880,
              checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
            }
          },
          400: buildErrorEnvelopeSchema("VALIDATION_ERROR", "Request validation failed"),
          401: buildErrorEnvelopeSchema("AUTH_TOKEN_INVALID", "Missing bearer token"),
          404: buildErrorEnvelopeSchema("UPLOAD_NOT_FOUND", "Upload session not found"),
          409: buildErrorEnvelopeSchema("UPLOAD_STATE_INVALID", "Upload session is not accepting parts")
        }
      }
    },
    async (request) => {
      const params = parseOrThrow(uploadPathParamsSchema, request.params || {});
      const query = parseOrThrow(uploadPartQuerySchema, request.query || {});
      const userId = request.userAuth.userId;

      const session = await app.repos.uploadSessions.findByIdForUser(params.uploadId, userId);
      ensureUploadSessionExists(session);

      if (!["initiated", "uploading"].includes(session.status)) {
        throw new ApiError(409, "UPLOAD_STATE_INVALID", "Upload session is not accepting parts", {
          status: session.status
        });
      }

      let partWriteResult;

      if (Buffer.isBuffer(request.body)) {
        if (request.body.length === 0) {
          throw new ApiError(400, "VALIDATION_ERROR", "Chunk payload cannot be empty");
        }

        if (request.body.length > session.part_size) {
          throw new ApiError(400, "UPLOAD_PART_TOO_LARGE", "Chunk exceeds configured part size", {
            partSize: session.part_size,
            receivedBytes: request.body.length
          });
        }

        const { relativePartPath } = await writeUploadPart({
          originalsRoot: app.config.uploadOriginalsPath,
          uploadId: params.uploadId,
          partNumber: query.partNumber,
          payload: request.body
        });

        partWriteResult = {
          relativePartPath,
          byteSize: request.body.length,
          checksumSha256: checksumSha256(request.body)
        };
      } else if (request.body && typeof request.body[Symbol.asyncIterator] === "function") {
        try {
          partWriteResult = await writeUploadPartStream({
            originalsRoot: app.config.uploadOriginalsPath,
            uploadId: params.uploadId,
            partNumber: query.partNumber,
            payloadStream: request.body,
            maxBytes: session.part_size
          });
        } catch (err) {
          if (err && err.code === "UPLOAD_PART_TOO_LARGE") {
            throw new ApiError(400, "UPLOAD_PART_TOO_LARGE", "Chunk exceeds configured part size", {
              partSize: session.part_size
            });
          }

          if (err && err.code === "UPLOAD_PART_EMPTY") {
            throw new ApiError(400, "VALIDATION_ERROR", "Chunk payload cannot be empty");
          }

          throw err;
        }
      } else {
        throw new ApiError(400, "VALIDATION_ERROR", "Chunk payload must be binary (application/octet-stream)");
      }

      const part = await app.repos.uploadParts.upsertPart({
        uploadId: params.uploadId,
        partNumber: query.partNumber,
        byteSize: partWriteResult.byteSize,
        checksumSha256: partWriteResult.checksumSha256,
        relativePartPath: partWriteResult.relativePartPath
      });

      await app.repos.uploadSessions.setStatus(params.uploadId, userId, "uploading");
      return buildPartResponse(part, params.uploadId);
    }
  );

  app.get(
    "/api/v1/uploads/:uploadId",
    {
      preHandler: accessGuard,
      schema: {
        tags: ["Uploads"],
        summary: "Get upload session status",
        description: "Return current upload session state and uploaded part progress.",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["uploadId"],
          properties: {
            uploadId: { type: "string", format: "uuid" }
          }
        },
        response: {
          200: {
            type: "object",
            required: [
              "uploadId",
              "status",
              "fileSize",
              "partSize",
              "uploadedBytes",
              "uploadedParts",
              "expiresAt"
            ],
            properties: {
              uploadId: { type: "string", format: "uuid" },
              status: { type: "string" },
              fileSize: { type: "integer", minimum: 1 },
              partSize: { type: "integer", minimum: 1 },
              uploadedBytes: { type: "integer", minimum: 0 },
              uploadedParts: {
                type: "array",
                items: { type: "integer", minimum: 1 }
              },
              expiresAt: { type: "string", format: "date-time" }
            },
            example: {
              uploadId: "30e71f52-775f-4a2f-a25d-aed8a48ac5d8",
              status: "uploading",
              fileSize: 3811212,
              partSize: 5242880,
              uploadedBytes: 1048576,
              uploadedParts: [1],
              expiresAt: "2026-02-15T18:00:00.000Z"
            }
          },
          401: buildErrorEnvelopeSchema("AUTH_TOKEN_INVALID", "Missing bearer token"),
          404: buildErrorEnvelopeSchema("UPLOAD_NOT_FOUND", "Upload session not found")
        }
      }
    },
    async (request) => {
      const params = parseOrThrow(uploadPathParamsSchema, request.params || {});
      const userId = request.userAuth.userId;
      const session = await app.repos.uploadSessions.findByIdForUser(params.uploadId, userId);
      ensureUploadSessionExists(session);

      const parts = await app.repos.uploadParts.listParts(params.uploadId);
      const uploadedBytes = await app.repos.uploadParts.getUploadedBytes(params.uploadId);
      const uploadedParts = parts.map((part) => part.part_number);
      return buildStatusResponse({ session, uploadedBytes, uploadedParts });
    }
  );

  app.post(
    "/api/v1/uploads/:uploadId/complete",
    {
      preHandler: writeGuards,
      schema: {
        tags: ["Uploads"],
        summary: "Complete upload",
        description:
          "Assemble uploaded parts, validate checksum, persist media metadata, and enqueue processing. Supports Idempotency-Key for safe retries.",
        security: [{ bearerAuth: [] }],
        headers: {
          type: "object",
          properties: {
            "idempotency-key": {
              type: "string",
              minLength: 1,
              description: "Optional key to safely retry completion and replay the same response."
            }
          },
          additionalProperties: true
        },
        params: {
          type: "object",
          required: ["uploadId"],
          properties: {
            uploadId: { type: "string", format: "uuid" }
          }
        },
        body: {
          type: "object",
          properties: {
            checksumSha256: { type: "string", pattern: "^[a-fA-F0-9]{64}$" }
          },
          additionalProperties: false,
          example: {
            checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69"
          }
        },
        response: {
          200: {
            type: "object",
            required: ["mediaId", "status", "deduplicated"],
            properties: {
              mediaId: { type: "string", format: "uuid" },
              status: { type: "string", enum: ["processing"] },
              deduplicated: { type: "boolean" }
            },
            example: {
              mediaId: "2f4b3f2f-48f7-4f18-b3cb-c08de94461e2",
              status: "processing",
              deduplicated: false
            }
          },
          400: buildErrorEnvelopeSchema("VALIDATION_ERROR", "Request validation failed"),
          415: buildErrorEnvelopeSchema("UNSUPPORTED_MEDIA_TYPE", "Unsupported or mismatched media type"),
          401: buildErrorEnvelopeSchema("AUTH_TOKEN_INVALID", "Missing bearer token"),
          404: buildErrorEnvelopeSchema("UPLOAD_NOT_FOUND", "Upload session not found"),
          409: buildErrorEnvelopeSchema("UPLOAD_STATE_INVALID", "Upload session is not ready for completion")
        }
      }
    },
    async (request, reply) => {
      const params = parseOrThrow(uploadPathParamsSchema, request.params || {});
      const body = parseOrThrow(completeUploadSchema, request.body || {});
      const userId = request.userAuth.userId;

      const idempotencyKey = readIdempotencyKey(request.headers);
      const requestHash = hashPayload({ uploadId: params.uploadId, ...body });
      if (idempotencyKey) {
        const existing = await app.repos.idempotency.find(
          userId,
          IDEMPOTENCY_SCOPE_UPLOAD_COMPLETE,
          idempotencyKey
        );
        if (existing) {
          assertMatchingIdempotencyHash(existing, requestHash);

          reply.code(existing.status_code).send(existing.response_body);
          return;
        }
      }

      const session = await app.repos.uploadSessions.findByIdForUser(params.uploadId, userId);
      ensureUploadSessionExists(session);

      if (session.status === "completed" && session.media_id) {
        const responseBody = buildCompleteResponse(session.media_id);
        if (idempotencyKey) {
          const persisted = await persistIdempotencyResult({
            app,
            userId,
            scope: IDEMPOTENCY_SCOPE_UPLOAD_COMPLETE,
            idemKey: idempotencyKey,
            requestHash,
            responseBody,
            statusCode: 200
          });
          reply.code(persisted.statusCode).send(persisted.responseBody);
          return;
        }

        return responseBody;
      }

      if (!["initiated", "uploading"].includes(session.status)) {
        throw new ApiError(409, "UPLOAD_STATE_INVALID", "Upload session is not ready for completion", {
          status: session.status
        });
      }

      const parts = await app.repos.uploadParts.listParts(params.uploadId);
      if (parts.length === 0) {
        throw new ApiError(409, "UPLOAD_INCOMPLETE", "No upload parts were found for this upload session");
      }

      const uploadedBytes = await app.repos.uploadParts.getUploadedBytes(params.uploadId);
      if (uploadedBytes !== Number(session.file_size)) {
        throw new ApiError(409, "UPLOAD_INCOMPLETE", "Uploaded bytes do not match expected file size", {
          expected: Number(session.file_size),
          uploaded: uploadedBytes
        });
      }

      const stagedMediaId = crypto.randomUUID();
      const stagedRelativePath = buildMediaRelativePath({
        userId,
        mediaId: stagedMediaId,
        fileName: session.file_name
      });

      let outputAbsolutePath;
      let keepAsPrimaryFile = false;

      try {
        outputAbsolutePath = await assemblePartsToFile({
          originalsRoot: app.config.uploadOriginalsPath,
          parts,
          outputRelativePath: stagedRelativePath
        });
      } catch (err) {
        if (err && err.code === "ENOENT") {
          const latestSession = await app.repos.uploadSessions.findByIdForUser(params.uploadId, userId);
          if (latestSession && latestSession.status === "completed" && latestSession.media_id) {
            const responseBody = buildCompleteResponse(latestSession.media_id);
            if (idempotencyKey) {
              const persisted = await persistIdempotencyResult({
                app,
                userId,
                scope: IDEMPOTENCY_SCOPE_UPLOAD_COMPLETE,
                idemKey: idempotencyKey,
                requestHash,
                responseBody,
                statusCode: 200
              });
              reply.code(persisted.statusCode).send(persisted.responseBody);
              return;
            }

            return responseBody;
          }

          throw new ApiError(409, "UPLOAD_INCOMPLETE", "Upload parts unavailable for completion");
        }

        throw err;
      }

      try {
        const expectedChecksum = body.checksumSha256 || session.checksum_sha256;
        const actualChecksum = await checksumFileSha256(outputAbsolutePath);
        if (actualChecksum !== expectedChecksum) {
          throw new ApiError(409, "UPLOAD_CHECKSUM_MISMATCH", "Checksum mismatch while completing upload", {
            expectedChecksum,
            actualChecksum
          });
        }

        const declaredContentType = normalizeContentType(session.content_type);
        const detectedContentType = await detectSupportedMimeTypeFromFile(outputAbsolutePath);
        const declaredExtension = getFileExtension(session.file_name);

        if (!detectedContentType) {
          throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Could not detect supported media type from uploaded bytes", {
            fileName: session.file_name,
            extension: declaredExtension,
            contentType: declaredContentType
          });
        }

        if (
          !isSupportedDeclaredMediaType({
            fileName: session.file_name,
            contentType: declaredContentType
          }) ||
          detectedContentType !== declaredContentType
        ) {
          throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported or mismatched media type", {
            fileName: session.file_name,
            extension: declaredExtension,
            declaredContentType,
            detectedContentType
          });
        }

        let responseBody;
        let shouldRemoveUploadTempDir = false;
        let queuePayload = null;

        const tx = await app.db.connect();
        try {
          await tx.query("BEGIN");

          const lockedSession = await app.repos.uploadSessions.findByIdForUserForUpdate(
            params.uploadId,
            userId,
            tx
          );
          ensureUploadSessionExists(lockedSession);

          if (lockedSession.status === "completed" && lockedSession.media_id) {
            responseBody = buildCompleteResponse(lockedSession.media_id);
          } else {
            if (!["initiated", "uploading"].includes(lockedSession.status)) {
              throw new ApiError(409, "UPLOAD_STATE_INVALID", "Upload session is not ready for completion", {
                status: lockedSession.status
              });
            }

            const lockedUploadedBytes = await app.repos.uploadParts.getUploadedBytes(params.uploadId, tx);
            if (lockedUploadedBytes !== Number(lockedSession.file_size)) {
              throw new ApiError(409, "UPLOAD_INCOMPLETE", "Uploaded bytes do not match expected file size", {
                expected: Number(lockedSession.file_size),
                uploaded: lockedUploadedBytes
              });
            }

            const duplicateMedia = await app.repos.media.findActiveByOwnerAndChecksum(
              {
                ownerId: userId,
                checksumSha256: actualChecksum
              },
              tx
            );

            if (duplicateMedia) {
              await app.repos.uploadSessions.markCompleted(
                {
                  id: params.uploadId,
                  userId,
                  mediaId: duplicateMedia.id,
                  storageRelativePath: duplicateMedia.relative_path
                },
                tx
              );

              responseBody = buildCompleteResponse(duplicateMedia.id, true);
              shouldRemoveUploadTempDir = true;
            } else {
              const media = await app.repos.media.create(
                {
                  id: stagedMediaId,
                  ownerId: userId,
                  relativePath: stagedRelativePath,
                  mimeType: lockedSession.content_type,
                  status: "processing",
                  checksumSha256: actualChecksum
                },
                tx
              );

              await app.repos.uploadSessions.markCompleted(
                {
                  id: params.uploadId,
                  userId,
                  mediaId: media.id,
                  storageRelativePath: stagedRelativePath
                },
                tx
              );

              responseBody = buildCompleteResponse(media.id, false);
              shouldRemoveUploadTempDir = true;
              queuePayload = buildMediaProcessMessage({
                mediaId: media.id,
                ownerId: userId,
                relativePath: stagedRelativePath,
                checksumSha256: media.checksum_sha256,
                uploadedAt: media.created_at
              });
            }
          }

          await tx.query("COMMIT");
        } catch (err) {
          await tx.query("ROLLBACK");
          throw err;
        } finally {
          tx.release();
        }

        keepAsPrimaryFile = queuePayload !== null;

        if (queuePayload) {
          await app.queues.mediaProcess.add(
            "media.process",
            queuePayload,
            {
              jobId: `media-process-${queuePayload.mediaId}`,
              attempts: 3,
              backoff: {
                type: "exponential",
                delay: 1000
              }
            }
          );
        }

        if (shouldRemoveUploadTempDir) {
          await removeUploadTempDir(app.config.uploadOriginalsPath, params.uploadId);
        }

        if (idempotencyKey) {
          const persisted = await persistIdempotencyResult({
            app,
            userId,
            scope: IDEMPOTENCY_SCOPE_UPLOAD_COMPLETE,
            idemKey: idempotencyKey,
            requestHash,
            responseBody,
            statusCode: 200
          });
          reply.code(persisted.statusCode).send(persisted.responseBody);
          return;
        }

        return responseBody;
      } finally {
        if (outputAbsolutePath && !keepAsPrimaryFile) {
          try {
            await fs.rm(outputAbsolutePath, { force: true });
          } catch (cleanupError) {
            request.log.warn(
              { err: cleanupError, outputAbsolutePath },
              "failed to remove staged assembled upload file"
            );
          }
        }
      }
    }
  );

  app.post(
    "/api/v1/uploads/:uploadId/abort",
    {
      preHandler: writeGuards,
      schema: {
        tags: ["Uploads"],
        summary: "Abort upload",
        description: "Abort an in-progress upload and remove temporary chunk files.",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["uploadId"],
          properties: {
            uploadId: { type: "string", format: "uuid" }
          }
        },
        response: {
          200: {
            type: "object",
            required: ["uploadId", "status"],
            properties: {
              uploadId: { type: "string", format: "uuid" },
              status: { type: "string", enum: ["aborted"] }
            },
            example: {
              uploadId: "30e71f52-775f-4a2f-a25d-aed8a48ac5d8",
              status: "aborted"
            }
          },
          401: buildErrorEnvelopeSchema("AUTH_TOKEN_INVALID", "Missing bearer token"),
          404: buildErrorEnvelopeSchema("UPLOAD_NOT_FOUND", "Upload session not found"),
          409: buildErrorEnvelopeSchema("UPLOAD_STATE_INVALID", "Completed upload cannot be aborted")
        }
      }
    },
    async (request) => {
      const params = parseOrThrow(uploadPathParamsSchema, request.params || {});
      const userId = request.userAuth.userId;
      const session = await app.repos.uploadSessions.findByIdForUser(params.uploadId, userId);
      ensureUploadSessionExists(session);

      if (session.status === "completed") {
        throw new ApiError(409, "UPLOAD_STATE_INVALID", "Completed upload cannot be aborted", {
          status: session.status
        });
      }

      if (session.status !== "aborted") {
        await app.repos.uploadSessions.markAborted(params.uploadId, userId);
      }
      await removeUploadTempDir(app.config.uploadOriginalsPath, params.uploadId);

      return {
        uploadId: params.uploadId,
        status: "aborted"
      };
    }
  );
};
