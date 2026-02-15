const crypto = require("node:crypto");

const { requireAccessAuth } = require("../auth/guard");
const { ApiError } = require("../errors");
const { initUploadSchema, parseOrThrow } = require("../validation");

const IDEMPOTENCY_SCOPE_UPLOAD_INIT = "upload_init";

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
  app.post(
    "/api/v1/uploads/init",
    {
      preHandler: requireAccessAuth(app.config),
      schema: {
        tags: ["Uploads"],
        summary: "Initialize upload session",
        description:
          "Create an upload session and return chunk size metadata for resumable part uploads.",
        security: [{ bearerAuth: [] }],
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

      const idempotencyKey = request.headers["idempotency-key"];
      if (idempotencyKey && typeof idempotencyKey !== "string") {
        throw new ApiError(400, "VALIDATION_ERROR", "Idempotency key must be a string");
      }

      const requestHash = hashPayload(body);
      if (idempotencyKey) {
        const existing = await app.repos.idempotency.find(userId, IDEMPOTENCY_SCOPE_UPLOAD_INIT, idempotencyKey);
        if (existing) {
          if (existing.request_hash !== requestHash) {
            throw new ApiError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Idempotency key was already used with a different request"
            );
          }

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
        await app.repos.idempotency.insert({
          userId,
          scope: IDEMPOTENCY_SCOPE_UPLOAD_INIT,
          idemKey: idempotencyKey,
          requestHash,
          responseBody,
          statusCode: 201
        });
      }

      reply.code(201).send(responseBody);
    }
  );
};
