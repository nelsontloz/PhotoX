const fsSync = require("node:fs");
const fs = require("node:fs/promises");

const { requireAccessAuth } = require("../auth/guard");
const { ApiError } = require("../errors");
const {
  buildDerivativeRelativePath,
  buildPlaybackRelativePath,
  resolveAbsolutePath
} = require("../media/paths");
const {
  mediaContentQuerySchema,
  mediaPathParamsSchema,
  parseOrThrow,
  patchMediaSchema,
  timelineQuerySchema,
  trashListQuerySchema,
  trashPreviewQuerySchema
} = require("../validation");
const { decodeTimelineCursor, encodeTimelineCursor } = require("../timeline/cursor");
const { buildMediaDerivativesGenerateMessage } = require("../contracts/mediaDerivativesMessage");
const { buildMediaCleanupMessage } = require("../contracts/mediaCleanupMessage");

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

function buildMetadataPreview(row) {
  const metadata = row.exif_json && typeof row.exif_json === "object" ? row.exif_json : null;
  const videoMetadata = metadata?.video || null;
  return {
    durationSec: typeof videoMetadata?.durationSec === "number" ? videoMetadata.durationSec : null,
    codec: typeof videoMetadata?.codec === "string" ? videoMetadata.codec : null,
    fps: typeof videoMetadata?.fps === "number" ? videoMetadata.fps : null,
    width: row.width,
    height: row.height
  };
}

function toTimelineMediaDto(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    takenAt: row.taken_at ? new Date(row.taken_at).toISOString() : null,
    uploadedAt: row.uploaded_at ? new Date(row.uploaded_at).toISOString() : new Date(row.created_at).toISOString(),
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    location: row.location_json,
    derivatives: {
      thumb: `/api/v1/media/${row.id}/content?variant=thumb`,
      small: `/api/v1/media/${row.id}/content?variant=small`,
      original: `/api/v1/media/${row.id}/content?variant=original`
    },
    metadataPreview: buildMetadataPreview(row),
    flags: {
      favorite: row.favorite,
      archived: row.archived,
      hidden: row.hidden,
      deletedSoft: row.deleted_soft
    }
  };
}

function toMediaDetailDto(row) {
  const metadata = row.exif_json && typeof row.exif_json === "object" ? row.exif_json : null;
  const videoMetadata = metadata?.video || null;

  return {
    ...toTimelineMediaDto(row),
    metadata: {
      capture: {
        takenAt: row.taken_at ? new Date(row.taken_at).toISOString() : null,
        uploadedAt: row.uploaded_at ? new Date(row.uploaded_at).toISOString() : new Date(row.created_at).toISOString()
      },
      image: metadata?.image || null,
      video: videoMetadata,
      location: row.location_json,
      raw: metadata
    }
  };
}

function encodeTrashCursor({ deletedAt, id }) {
  return Buffer.from(
    JSON.stringify({
      deletedAt,
      id
    })
  ).toString("base64url");
}

function decodeTrashCursor(value) {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!decoded || typeof decoded.deletedAt !== "string" || typeof decoded.id !== "string") {
      throw new Error("Invalid trash cursor shape");
    }

    if (Number.isNaN(Date.parse(decoded.deletedAt))) {
      throw new Error("Invalid trash cursor timestamp");
    }

    return decoded;
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed", {
      issues: [
        {
          path: ["cursor"],
          message: "Invalid cursor"
        }
      ]
    });
  }
}

function toTrashMediaDto(row) {
  return {
    ...toTimelineMediaDto(row),
    deletedAt: row.deleted_soft_at ? new Date(row.deleted_soft_at).toISOString() : null
  };
}

module.exports = async function libraryRoutes(app) {
  app.get(
    "/api/v1/library/timeline",
    {
      preHandler: requireAccessAuth(app.config),
      schema: {
        tags: ["Library"],
        summary: "Get timeline",
        description:
          "Return paginated media cards ordered by timeline sort keys with stable cursor pagination.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            cursor: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 100 },
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            favorite: { type: "boolean" },
            archived: { type: "boolean" },
            hidden: { type: "boolean" },
            albumId: { type: "string", format: "uuid" },
            personId: { type: "string", format: "uuid" },
            q: { type: "string" }
          },
          additionalProperties: false
        },
        response: {
          200: {
            type: "object",
            required: ["items", "nextCursor"],
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  required: ["id", "ownerId", "takenAt", "uploadedAt", "mimeType", "flags"],
                  properties: {
                    id: { type: "string", format: "uuid" },
                    ownerId: { type: "string", format: "uuid" },
                    takenAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
                    uploadedAt: { type: "string", format: "date-time" },
                    mimeType: { type: "string" },
                    width: { anyOf: [{ type: "integer" }, { type: "null" }] },
                    height: { anyOf: [{ type: "integer" }, { type: "null" }] },
                    location: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
                    metadataPreview: {
                      type: "object",
                      required: ["durationSec", "codec", "fps", "width", "height"],
                      properties: {
                        durationSec: { anyOf: [{ type: "number" }, { type: "null" }] },
                        codec: { anyOf: [{ type: "string" }, { type: "null" }] },
                        fps: { anyOf: [{ type: "number" }, { type: "null" }] },
                        width: { anyOf: [{ type: "integer" }, { type: "null" }] },
                        height: { anyOf: [{ type: "integer" }, { type: "null" }] }
                      }
                    },
                    flags: {
                      type: "object",
                      required: ["favorite", "archived", "hidden", "deletedSoft"],
                      properties: {
                        favorite: { type: "boolean" },
                        archived: { type: "boolean" },
                        hidden: { type: "boolean" },
                        deletedSoft: { type: "boolean" }
                      }
                    }
                  }
                }
              },
              nextCursor: { anyOf: [{ type: "string" }, { type: "null" }] }
            }
          },
          400: buildErrorEnvelopeSchema("VALIDATION_ERROR", "Request validation failed"),
          401: buildErrorEnvelopeSchema("AUTH_TOKEN_INVALID", "Missing bearer token")
        }
      }
    },
    async (request) => {
      const query = parseOrThrow(timelineQuerySchema, request.query || {});
      if (query.albumId || query.personId) {
        throw new ApiError(
          400,
          "FILTER_NOT_SUPPORTED",
          "albumId and personId filters are not available in this phase"
        );
      }

      const cursor = query.cursor ? decodeTimelineCursor(query.cursor) : null;
      const limit = Math.min(query.limit || app.config.timelineDefaultLimit, app.config.timelineMaxLimit);
      const rows = await app.repos.library.listTimeline({
        ownerId: request.userAuth.userId,
        limit,
        from: query.from ? new Date(query.from).toISOString() : null,
        to: query.to ? new Date(query.to).toISOString() : null,
        favorite: query.favorite,
        archived: query.archived,
        hidden: query.hidden,
        q: query.q,
        cursorSortAt: cursor ? cursor.sortAt : null,
        cursorId: cursor ? cursor.id : null
      });

      const hasMore = rows.length > limit;
      const visibleRows = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore
        ? encodeTimelineCursor({
            sortAt: new Date(visibleRows[visibleRows.length - 1].sort_at).toISOString(),
            id: visibleRows[visibleRows.length - 1].id
          })
        : null;

      return {
        items: visibleRows.map(toTimelineMediaDto),
        nextCursor
      };
    }
  );

  app.get(
    "/api/v1/media/:mediaId",
    {
      preHandler: requireAccessAuth(app.config),
      schema: {
        tags: ["Media"],
        summary: "Get media detail",
        description: "Return metadata and flag state for a single media item owned by the caller.",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["mediaId"],
          properties: {
            mediaId: { type: "string", format: "uuid" }
          }
        },
        response: {
          200: {
            type: "object",
            required: ["media"],
            properties: {
              media: {
                type: "object",
                required: ["id", "ownerId", "takenAt", "uploadedAt", "mimeType", "flags"],
                properties: {
                  id: { type: "string", format: "uuid" },
                  ownerId: { type: "string", format: "uuid" },
                  takenAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
                  uploadedAt: { type: "string", format: "date-time" },
                  mimeType: { type: "string" },
                  width: { anyOf: [{ type: "integer" }, { type: "null" }] },
                  height: { anyOf: [{ type: "integer" }, { type: "null" }] },
                  location: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
                  metadataPreview: {
                    type: "object",
                    required: ["durationSec", "codec", "fps", "width", "height"],
                    properties: {
                      durationSec: { anyOf: [{ type: "number" }, { type: "null" }] },
                      codec: { anyOf: [{ type: "string" }, { type: "null" }] },
                      fps: { anyOf: [{ type: "number" }, { type: "null" }] },
                      width: { anyOf: [{ type: "integer" }, { type: "null" }] },
                      height: { anyOf: [{ type: "integer" }, { type: "null" }] }
                    }
                  },
                  metadata: {
                    type: "object",
                    required: ["capture", "image", "video", "location", "raw"],
                    properties: {
                      capture: {
                        type: "object",
                        required: ["takenAt", "uploadedAt"],
                        properties: {
                          takenAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
                          uploadedAt: { type: "string", format: "date-time" }
                        }
                      },
                      image: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
                      video: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
                      location: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
                      raw: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] }
                    }
                  },
                  flags: {
                    type: "object",
                    required: ["favorite", "archived", "hidden", "deletedSoft"],
                    properties: {
                      favorite: { type: "boolean" },
                      archived: { type: "boolean" },
                      hidden: { type: "boolean" },
                      deletedSoft: { type: "boolean" }
                    }
                  }
                }
              }
            }
          },
          401: buildErrorEnvelopeSchema("AUTH_TOKEN_INVALID", "Missing bearer token"),
          404: buildErrorEnvelopeSchema("MEDIA_NOT_FOUND", "Media was not found")
        }
      }
    },
    async (request) => {
      const params = parseOrThrow(mediaPathParamsSchema, request.params || {});
      const media = await app.repos.library.findOwnedMediaDetails(params.mediaId, request.userAuth.userId);
      if (!media) {
        throw new ApiError(404, "MEDIA_NOT_FOUND", "Media was not found");
      }

      return {
        media: toMediaDetailDto(media)
      };
    }
  );

  app.get(
    "/api/v1/library/trash",
    {
      preHandler: requireAccessAuth(app.config),
      schema: {
        tags: ["Library"],
        summary: "List trash items",
        description:
          "Return paginated soft-deleted media items for the authenticated user ordered by deletion time.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            cursor: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 100 }
          },
          additionalProperties: false
        },
        response: {
          200: {
            type: "object",
            required: ["items", "nextCursor"],
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  required: [
                    "id",
                    "ownerId",
                    "takenAt",
                    "uploadedAt",
                    "mimeType",
                    "flags",
                    "deletedAt"
                  ],
                  properties: {
                    id: { type: "string", format: "uuid" },
                    ownerId: { type: "string", format: "uuid" },
                    takenAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
                    uploadedAt: { type: "string", format: "date-time" },
                    mimeType: { type: "string" },
                    deletedAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
                    flags: {
                      type: "object",
                      required: ["favorite", "archived", "hidden", "deletedSoft"],
                      properties: {
                        favorite: { type: "boolean" },
                        archived: { type: "boolean" },
                        hidden: { type: "boolean" },
                        deletedSoft: { type: "boolean" }
                      }
                    }
                  }
                }
              },
              nextCursor: { anyOf: [{ type: "string" }, { type: "null" }] }
            }
          },
          400: buildErrorEnvelopeSchema("VALIDATION_ERROR", "Request validation failed"),
          401: buildErrorEnvelopeSchema("AUTH_TOKEN_INVALID", "Missing bearer token")
        }
      }
    },
    async (request) => {
      const query = parseOrThrow(trashListQuerySchema, request.query || {});
      const cursor = query.cursor ? decodeTrashCursor(query.cursor) : null;
      const limit = Math.min(query.limit || app.config.timelineDefaultLimit, app.config.timelineMaxLimit);
      const rows = await app.repos.library.listTrash({
        ownerId: request.userAuth.userId,
        limit,
        cursorDeletedSoftAt: cursor?.deletedAt || null,
        cursorId: cursor?.id || null
      });

      const hasMore = rows.length > limit;
      const visibleRows = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore
        ? encodeTrashCursor({
            deletedAt: new Date(visibleRows[visibleRows.length - 1].deleted_soft_at).toISOString(),
            id: visibleRows[visibleRows.length - 1].id
          })
        : null;

      return {
        items: visibleRows.map(toTrashMediaDto),
        nextCursor
      };
    }
  );

  app.delete(
    "/api/v1/library/trash",
    {
      preHandler: requireAccessAuth(app.config),
      schema: {
        tags: ["Library"],
        summary: "Empty trash",
        description:
          "Queue immediate cleanup jobs for all currently soft-deleted media owned by the authenticated user.",
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: "object",
            required: ["status", "queuedCount"],
            properties: {
              status: { type: "string", enum: ["queued"] },
              queuedCount: { type: "integer", minimum: 0 }
            }
          },
          401: buildErrorEnvelopeSchema("AUTH_TOKEN_INVALID", "Missing bearer token")
        }
      }
    },
    async (request) => {
      const trashedRows = await app.repos.library.listTrashedMediaForCleanup(request.userAuth.userId);
      const hardDeleteAt = new Date();
      let queuedCount = 0;

      for (const row of trashedRows) {
        try {
          await app.queues.mediaCleanup.add(
            "media.cleanup",
            buildMediaCleanupMessage({
              mediaId: row.id,
              ownerId: row.owner_id,
              hardDeleteAt
            }),
            {
              jobId: `media-cleanup-${row.id}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
              attempts: 5,
              backoff: {
                type: "exponential",
                delay: 3000
              }
            }
          );
          queuedCount += 1;
        } catch (err) {
          request.log.warn({ err, mediaId: row.id }, "failed to enqueue immediate cleanup job");
        }
      }

      return {
        status: "queued",
        queuedCount
      };
    }
  );

  app.get(
    "/api/v1/library/trash/:mediaId/preview",
    {
      preHandler: requireAccessAuth(app.config),
      schema: {
        tags: ["Library"],
        summary: "Read trashed media preview",
        description:
          "Return an existing derived preview image for a soft-deleted media item owned by the caller. This endpoint does not serve originals and does not enqueue derivative generation.",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["mediaId"],
          properties: {
            mediaId: { type: "string", format: "uuid" }
          }
        },
        querystring: {
          type: "object",
          properties: {
            variant: {
              type: "string",
              enum: ["thumb", "small"]
            }
          },
          additionalProperties: false
        },
        response: {
          400: buildErrorEnvelopeSchema("VALIDATION_ERROR", "Request validation failed"),
          401: buildErrorEnvelopeSchema("AUTH_TOKEN_INVALID", "Missing bearer token"),
          404: buildErrorEnvelopeSchema("MEDIA_NOT_FOUND", "Media was not found")
        }
      }
    },
    async (request, reply) => {
      const params = parseOrThrow(mediaPathParamsSchema, request.params || {});
      const query = parseOrThrow(trashPreviewQuerySchema, request.query || {});
      const variant = query.variant || "thumb";
      const media = await app.repos.library.findOwnedMediaDetails(params.mediaId, request.userAuth.userId);

      if (!media || !media.deleted_soft) {
        throw new ApiError(404, "MEDIA_NOT_FOUND", "Media was not found");
      }

      const derivativeRelativePath = buildDerivativeRelativePath(media.relative_path, media.id, variant);
      const derivativeAbsolutePath = resolveAbsolutePath(app.config.uploadDerivedPath, derivativeRelativePath);

      try {
        await fs.stat(derivativeAbsolutePath);
      } catch (err) {
        if (err && err.code === "ENOENT") {
          throw new ApiError(404, "MEDIA_NOT_FOUND", "Media was not found");
        }
        throw err;
      }

      reply.type("image/webp");
      reply.header("cache-control", "private, max-age=120");
      reply.header("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'");
      return reply.send(fsSync.createReadStream(derivativeAbsolutePath));
    }
  );

  app.patch(
    "/api/v1/media/:mediaId",
    {
      preHandler: requireAccessAuth(app.config),
      schema: {
        tags: ["Media"],
        summary: "Update media flags and takenAt",
        description: "Update media timeline flags and optional taken-at timestamp.",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["mediaId"],
          properties: {
            mediaId: { type: "string", format: "uuid" }
          }
        },
        body: {
          type: "object",
          properties: {
            favorite: { type: "boolean" },
            archived: { type: "boolean" },
            hidden: { type: "boolean" },
            takenAt: {
              anyOf: [{ type: "string", format: "date-time" }, { type: "null" }]
            }
          },
          additionalProperties: false
        },
        response: {
          200: {
            type: "object",
            required: ["media"],
            properties: {
              media: {
                type: "object",
                required: ["id", "ownerId", "takenAt", "uploadedAt", "mimeType", "flags"],
                properties: {
                  id: { type: "string", format: "uuid" },
                  ownerId: { type: "string", format: "uuid" },
                  takenAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
                  uploadedAt: { type: "string", format: "date-time" },
                  mimeType: { type: "string" },
                  width: { anyOf: [{ type: "integer" }, { type: "null" }] },
                  height: { anyOf: [{ type: "integer" }, { type: "null" }] },
                  location: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
                  metadataPreview: {
                    type: "object",
                    required: ["durationSec", "codec", "fps", "width", "height"],
                    properties: {
                      durationSec: { anyOf: [{ type: "number" }, { type: "null" }] },
                      codec: { anyOf: [{ type: "string" }, { type: "null" }] },
                      fps: { anyOf: [{ type: "number" }, { type: "null" }] },
                      width: { anyOf: [{ type: "integer" }, { type: "null" }] },
                      height: { anyOf: [{ type: "integer" }, { type: "null" }] }
                    }
                  },
                  metadata: {
                    type: "object",
                    required: ["capture", "image", "video", "location", "raw"],
                    properties: {
                      capture: {
                        type: "object",
                        required: ["takenAt", "uploadedAt"],
                        properties: {
                          takenAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
                          uploadedAt: { type: "string", format: "date-time" }
                        }
                      },
                      image: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
                      video: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
                      location: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
                      raw: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] }
                    }
                  },
                  flags: {
                    type: "object",
                    required: ["favorite", "archived", "hidden", "deletedSoft"],
                    properties: {
                      favorite: { type: "boolean" },
                      archived: { type: "boolean" },
                      hidden: { type: "boolean" },
                      deletedSoft: { type: "boolean" }
                    }
                  }
                }
              }
            }
          },
          400: buildErrorEnvelopeSchema("VALIDATION_ERROR", "Request validation failed"),
          401: buildErrorEnvelopeSchema("AUTH_TOKEN_INVALID", "Missing bearer token"),
          404: buildErrorEnvelopeSchema("MEDIA_NOT_FOUND", "Media was not found")
        }
      }
    },
    async (request) => {
      const params = parseOrThrow(mediaPathParamsSchema, request.params || {});
      const patch = parseOrThrow(patchMediaSchema, request.body || {});
      const media = await app.repos.library.patchMedia(params.mediaId, request.userAuth.userId, {
        favorite: patch.favorite,
        archived: patch.archived,
        hidden: patch.hidden,
        takenAt: patch.takenAt === undefined || patch.takenAt === null ? patch.takenAt : new Date(patch.takenAt)
      });

      if (!media) {
        throw new ApiError(404, "MEDIA_NOT_FOUND", "Media was not found");
      }

      return {
        media: toMediaDetailDto(media)
      };
    }
  );

  app.get(
    "/api/v1/media/:mediaId/content",
    {
      preHandler: requireAccessAuth(app.config),
      schema: {
        tags: ["Media"],
        summary: "Read media content",
        description:
          "Return original media bytes, serve existing image WebP derivatives, or serve video playback WebM derivatives. Missing image derivatives queue generation and fall back to source bytes; missing playback derivatives queue generation and return a retriable error.",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["mediaId"],
          properties: {
            mediaId: { type: "string", format: "uuid" }
          }
        },
        querystring: {
          type: "object",
          properties: {
            variant: {
              type: "string",
              enum: ["original", "thumb", "small", "playback"]
            }
          },
          additionalProperties: false
        },
        response: {
          400: buildErrorEnvelopeSchema("VALIDATION_ERROR", "Request validation failed"),
          401: buildErrorEnvelopeSchema("AUTH_TOKEN_INVALID", "Missing bearer token"),
          404: buildErrorEnvelopeSchema("MEDIA_NOT_FOUND", "Media was not found"),
          503: buildErrorEnvelopeSchema(
            "PLAYBACK_DERIVATIVE_NOT_READY",
            "Playback derivative is not ready; retry later",
            {
              mediaId: "00000000-0000-0000-0000-000000000000",
              variant: "playback",
              retriable: true,
              queued: true
            }
          )
        }
      }
    },
    async (request, reply) => {
      const params = parseOrThrow(mediaPathParamsSchema, request.params || {});
      const query = parseOrThrow(mediaContentQuerySchema, request.query || {});
      const variant = query.variant || "original";
      const media = await app.repos.library.findOwnedMediaDetails(params.mediaId, request.userAuth.userId);

      if (!media) {
        throw new ApiError(404, "MEDIA_NOT_FOUND", "Media was not found");
      }

      if (media.deleted_soft) {
        throw new ApiError(404, "MEDIA_NOT_FOUND", "Media was not found");
      }

      if (variant === "playback" && !media.mime_type.startsWith("video/")) {
        throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed", {
          issues: [
            {
              path: ["variant"],
              message: "playback variant is only supported for video media"
            }
          ]
        });
      }

      try {
        let contentType = media.mime_type;
        let absolutePath;

        if (variant === "original") {
          absolutePath = resolveAbsolutePath(app.config.uploadOriginalsPath, media.relative_path);
        } else if (variant === "playback") {
          const playbackRelativePath = buildPlaybackRelativePath(media.relative_path, media.id);
          const playbackAbsolutePath = resolveAbsolutePath(app.config.uploadDerivedPath, playbackRelativePath);

          try {
            await fs.stat(playbackAbsolutePath);
            absolutePath = playbackAbsolutePath;
            contentType = "video/webm";
          } catch (err) {
            if (err.code !== "ENOENT") {
              throw err;
            }

            let queued = false;
            try {
              await app.queues.mediaDerivatives.add(
                "media.derivatives.generate",
                buildMediaDerivativesGenerateMessage({
                  mediaId: media.id,
                  ownerId: media.owner_id,
                  relativePath: media.relative_path,
                  requestedAt: new Date()
                }),
                {
                  jobId: `media-derivatives-${media.id}`,
                  attempts: 5,
                  backoff: {
                    type: "exponential",
                    delay: 3000
                  }
                }
              );
              queued = true;
            } catch (enqueueErr) {
              request.log.warn(
                { err: enqueueErr, mediaId: media.id },
                "failed to enqueue derivative generation job"
              );
            }

            throw new ApiError(503, "PLAYBACK_DERIVATIVE_NOT_READY", "Playback derivative is not ready; retry later", {
              mediaId: media.id,
              variant: "playback",
              retriable: true,
              queued
            });
          }
        } else {
          const derivativeRelativePath = buildDerivativeRelativePath(media.relative_path, media.id, variant);
          const derivativeAbsolutePath = resolveAbsolutePath(app.config.uploadDerivedPath, derivativeRelativePath);

          try {
            await fs.stat(derivativeAbsolutePath);
            absolutePath = derivativeAbsolutePath;
            contentType = "image/webp";
          } catch (err) {
            if (err.code !== "ENOENT") {
              throw err;
            }

            absolutePath = resolveAbsolutePath(app.config.uploadOriginalsPath, media.relative_path);
            try {
              await app.queues.mediaDerivatives.add(
                "media.derivatives.generate",
                buildMediaDerivativesGenerateMessage({
                  mediaId: media.id,
                  ownerId: media.owner_id,
                  relativePath: media.relative_path,
                  requestedAt: new Date()
                }),
                {
                  jobId: `media-derivatives-${media.id}`,
                  attempts: 5,
                  backoff: {
                    type: "exponential",
                    delay: 3000
                  }
                }
              );
            } catch (enqueueErr) {
              request.log.warn(
                { err: enqueueErr, mediaId: media.id },
                "failed to enqueue derivative generation job"
              );
            }
          }
        }

        try {
          await fs.stat(absolutePath);
        } catch (err) {
          if (err.code === "ENOENT") {
            throw new ApiError(404, "MEDIA_CONTENT_NOT_FOUND", "Media file was not found");
          }
          throw err;
        }

        reply.type(contentType);
        reply.header("cache-control", "private, max-age=120");
        reply.header("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'");
        return reply.send(fsSync.createReadStream(absolutePath));
      } catch (err) {
        if (err instanceof ApiError) {
          throw err;
        }

        if (err && err.code === "ENOENT") {
          throw new ApiError(404, "MEDIA_CONTENT_NOT_FOUND", "Media file was not found");
        }

        throw err;
      }
    }
  );

  app.delete(
    "/api/v1/media/:mediaId",
    {
      preHandler: requireAccessAuth(app.config),
      schema: {
        tags: ["Media"],
        summary: "Soft delete media",
        description: "Mark media as soft deleted so it no longer appears in timeline queries.",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["mediaId"],
          properties: {
            mediaId: { type: "string", format: "uuid" }
          }
        },
        response: {
          200: {
            type: "object",
            required: ["mediaId", "status"],
            properties: {
              mediaId: { type: "string", format: "uuid" },
              status: { type: "string", enum: ["deleted"] }
            }
          },
          401: buildErrorEnvelopeSchema("AUTH_TOKEN_INVALID", "Missing bearer token"),
          404: buildErrorEnvelopeSchema("MEDIA_NOT_FOUND", "Media was not found")
        }
      }
    },
    async (request) => {
      const params = parseOrThrow(mediaPathParamsSchema, request.params || {});
      const result = await app.repos.library.setDeletedSoft(params.mediaId, request.userAuth.userId, true);
      if (!result) {
        throw new ApiError(404, "MEDIA_NOT_FOUND", "Media was not found");
      }

      const hardDeleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const delayMs = Math.max(0, hardDeleteAt.getTime() - Date.now());
      try {
        await app.queues.mediaCleanup.add(
          "media.cleanup",
          buildMediaCleanupMessage({
            mediaId: params.mediaId,
            ownerId: request.userAuth.userId,
            hardDeleteAt
          }),
          {
            jobId: `media-cleanup-${params.mediaId}-${Date.now()}`,
            delay: delayMs,
            attempts: 5,
            backoff: {
              type: "exponential",
              delay: 3000
            }
          }
        );
      } catch (err) {
        request.log.warn({ err, mediaId: params.mediaId }, "failed to enqueue delayed cleanup job");
      }

      return {
        mediaId: params.mediaId,
        status: "deleted"
      };
    }
  );

  app.post(
    "/api/v1/media/:mediaId/restore",
    {
      preHandler: requireAccessAuth(app.config),
      schema: {
        tags: ["Media"],
        summary: "Restore media",
        description: "Restore a previously soft-deleted media item so it appears in timeline queries again.",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["mediaId"],
          properties: {
            mediaId: { type: "string", format: "uuid" }
          }
        },
        response: {
          200: {
            type: "object",
            required: ["mediaId", "status"],
            properties: {
              mediaId: { type: "string", format: "uuid" },
              status: { type: "string", enum: ["active"] }
            }
          },
          401: buildErrorEnvelopeSchema("AUTH_TOKEN_INVALID", "Missing bearer token"),
          404: buildErrorEnvelopeSchema("MEDIA_NOT_FOUND", "Media was not found")
        }
      }
    },
    async (request) => {
      const params = parseOrThrow(mediaPathParamsSchema, request.params || {});
      const result = await app.repos.library.setDeletedSoft(params.mediaId, request.userAuth.userId, false);
      if (!result) {
        throw new ApiError(404, "MEDIA_NOT_FOUND", "Media was not found");
      }

      return {
        mediaId: params.mediaId,
        status: "active"
      };
    }
  );
};
