const { z } = require("zod");
const { validateBody, validateQuery, validateParams } = require("../validation");
const requireAuth = require("../auth/requireAuth");

function albumRoutes(fastify, options, done) {
    const { album } = fastify.repos;

    fastify.post(
        "/",
        {
            preHandler: [requireAuth],
            schema: {
                tags: ["Albums"],
                summary: "Create a new album",
                description: "Creates an album owned by the authenticated user",
                security: [{ bearerAuth: [] }],
                body: {
                    type: "object",
                    required: ["title"],
                    properties: {
                        title: { type: "string", minLength: 1, maxLength: 1024 }
                    },
                    example: { title: "Summer Vacation 2026" }
                },
                response: {
                    200: {
                        type: "object",
                        properties: {
                            id: { type: "string" },
                            ownerId: { type: "string" },
                            title: { type: "string" },
                            createdAt: { type: "string", format: "date-time" },
                            updatedAt: { type: "string", format: "date-time" },
                            mediaCount: { type: "integer" }
                        }
                    }
                }
            }
        },
        async (request) => {
            const { title } = validateBody(
                request.body,
                z.object({
                    title: z.string().min(1).max(1024)
                })
            );

            const result = await album.createAlbum({
                ownerId: request.user.id,
                title
            });

            return { ...result, mediaCount: 0 };
        }
    );

    fastify.get(
        "/",
        {
            preHandler: [requireAuth],
            schema: {
                tags: ["Albums"],
                summary: "List albums",
                description: "Returns albums owned by the authenticated user",
                security: [{ bearerAuth: [] }],
                querystring: {
                    type: "object",
                    properties: {
                        limit: { type: "integer", minimum: 1, maximum: 100 }
                    }
                },
                response: {
                    200: {
                        type: "object",
                        properties: {
                            items: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        id: { type: "string" },
                                        ownerId: { type: "string" },
                                        title: { type: "string" },
                                        createdAt: { type: "string", format: "date-time" },
                                        updatedAt: { type: "string", format: "date-time" },
                                        mediaCount: { type: "integer" },
                                        sampleMediaIds: {
                                            type: "array",
                                            items: { type: "string" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        async (request) => {
            const { limit } = validateQuery(
                request.query,
                z.object({
                    limit: z.coerce.number().int().min(1).max(100).optional().default(50)
                })
            );

            const items = await album.listAlbums({
                ownerId: request.user.id,
                limit
            });

            return { items };
        }
    );

    fastify.get(
        "/:albumId",
        {
            preHandler: [requireAuth],
            schema: {
                tags: ["Albums"],
                summary: "Get album details",
                description: "Returns the album detail including media count. Must be the album owner.",
                security: [{ bearerAuth: [] }],
                params: {
                    type: "object",
                    required: ["albumId"],
                    properties: {
                        albumId: { type: "string" }
                    }
                },
                response: {
                    200: {
                        type: "object",
                        properties: {
                            id: { type: "string" },
                            ownerId: { type: "string" },
                            title: { type: "string" },
                            createdAt: { type: "string", format: "date-time" },
                            updatedAt: { type: "string", format: "date-time" },
                            mediaCount: { type: "integer" }
                        }
                    }
                }
            }
        },
        async (request) => {
            const { albumId } = validateParams(
                request.params,
                z.object({
                    albumId: z.string().min(1)
                })
            );

            return await album.getAlbumWithItemCount({
                albumId,
                ownerId: request.user.id
            });
        }
    );

    fastify.post(
        "/:albumId/items",
        {
            preHandler: [requireAuth],
            schema: {
                tags: ["Albums"],
                summary: "Add media to album",
                description: "Adds an existing media item to the specified album. Fails if user does not own the media or album.",
                security: [{ bearerAuth: [] }],
                params: {
                    type: "object",
                    required: ["albumId"],
                    properties: {
                        albumId: { type: "string" }
                    }
                },
                body: {
                    type: "object",
                    required: ["mediaId"],
                    properties: {
                        mediaId: { type: "string" }
                    },
                    example: { mediaId: "med_12345" }
                },
                response: {
                    200: {
                        type: "object",
                        properties: {
                            albumId: { type: "string" },
                            mediaId: { type: "string" }
                        }
                    }
                }
            }
        },
        async (request) => {
            const { albumId } = validateParams(
                request.params,
                z.object({
                    albumId: z.string().min(1)
                })
            );
            const { mediaId } = validateBody(
                request.body,
                z.object({
                    mediaId: z.string().min(1)
                })
            );

            return await album.addMediaToAlbum({
                albumId,
                ownerId: request.user.id,
                mediaId
            });
        }
    );

    fastify.get(
        "/:albumId/items",
        {
            preHandler: [requireAuth],
            schema: {
                tags: ["Albums"],
                summary: "Get album items",
                description: "Gets the list of media items in an album",
                security: [{ bearerAuth: [] }],
                params: {
                    type: "object",
                    required: ["albumId"],
                    properties: {
                        albumId: { type: "string" }
                    }
                },
                response: {
                    200: {
                        type: "object",
                        properties: {
                            items: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        mediaId: { type: "string" },
                                        addedAt: { type: "string", format: "date-time" },
                                        mimeType: { type: "string" }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        async (request) => {
            const { albumId } = validateParams(
                request.params,
                z.object({
                    albumId: z.string().min(1)
                })
            );

            const items = await album.getAlbumItems({
                albumId,
                ownerId: request.user.id
            });

            return { items };
        }
    );

    fastify.delete(
        "/:albumId/items/:mediaId",
        {
            preHandler: [requireAuth],
            schema: {
                tags: ["Albums"],
                summary: "Remove media from album",
                description: "Removes a media item from an album. Fails if user does not own the album.",
                security: [{ bearerAuth: [] }],
                params: {
                    type: "object",
                    required: ["albumId", "mediaId"],
                    properties: {
                        albumId: { type: "string" },
                        mediaId: { type: "string" }
                    }
                },
                response: {
                    200: {
                        type: "object",
                        properties: {
                            albumId: { type: "string" },
                            mediaId: { type: "string" }
                        }
                    }
                }
            }
        },
        async (request) => {
            const { albumId, mediaId } = validateParams(
                request.params,
                z.object({
                    albumId: z.string().min(1),
                    mediaId: z.string().min(1)
                })
            );

            return await album.removeMediaFromAlbum({
                albumId,
                ownerId: request.user.id,
                mediaId
            });
        }
    );

    done();
}

module.exports = albumRoutes;
