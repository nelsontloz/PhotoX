const fsSync = require("node:fs");

const { requireAccessAuth } = require("../auth/guard");
const { ApiError } = require("../errors");
const { ensureWebpDerivative } = require("../media/derivatives");
const { resolveAbsolutePath } = require("../media/paths");
const {
  mediaContentQuerySchema,
  mediaPathParamsSchema,
  parseOrThrow,
  patchMediaSchema,
  timelineQuerySchema
} = require("../validation");
const { decodeTimelineCursor, encodeTimelineCursor } = require("../timeline/cursor");

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

function toMediaDto(row) {
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
    flags: {
      favorite: row.favorite,
      archived: row.archived,
      hidden: row.hidden,
      deletedSoft: row.deleted_soft
    }
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
        items: visibleRows.map(toMediaDto),
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
        media: toMediaDto(media)
      };
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
        media: toMediaDto(media)
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
          "Return original media bytes or generate and return WebP derivatives for timeline display.",
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
              enum: ["original", "thumb", "small"]
            }
          },
          additionalProperties: false
        },
        response: {
          401: buildErrorEnvelopeSchema("AUTH_TOKEN_INVALID", "Missing bearer token"),
          404: buildErrorEnvelopeSchema("MEDIA_NOT_FOUND", "Media was not found")
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

      try {
        let contentType = media.mime_type;
        let absolutePath;

        if (variant === "original") {
          absolutePath = resolveAbsolutePath(app.config.uploadOriginalsPath, media.relative_path);
        } else {
          const derivative = await ensureWebpDerivative({
            originalsRoot: app.config.uploadOriginalsPath,
            derivedRoot: app.config.uploadDerivedPath,
            mediaRow: media,
            variant
          });
          absolutePath = derivative.absolutePath;
          contentType = derivative.contentType;
        }

        if (!fsSync.existsSync(absolutePath)) {
          throw new ApiError(404, "MEDIA_CONTENT_NOT_FOUND", "Media file was not found");
        }

        reply.type(contentType);
        reply.header("cache-control", "private, max-age=120");
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
