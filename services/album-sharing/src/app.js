const Fastify = require("fastify");
const swagger = require("@fastify/swagger");
const swaggerUi = require("@fastify/swagger-ui");

const { loadConfig } = require("./config");
const { createPool, runMigrations } = require("./db");
const { ApiError, toErrorBody } = require("./errors");
const { buildAlbumRepo } = require("./repos/albumRepo");
const openapiRoute = require("./routes/openapiRoute");
const albumRoutes = require("./routes/albumRoutes");

function buildApp(overrides = {}) {
    const app = Fastify({
        logger: true,
        ajv: {
            plugins: [
                (ajv) => {
                    ajv.addKeyword("example");
                }
            ]
        }
    });

    const config = loadConfig(overrides);
    const db = overrides.db || createPool(config.databaseUrl);

    app.decorate("config", config);
    app.decorate("db", db);
    app.decorate("repos", {
        album: buildAlbumRepo(db)
    });

    app.addContentTypeParser(
        "*",
        {
            parseAs: "string"
        },
        function parseUnknownContentType(_request, body, done) {
            if (body == null) {
                done(null, undefined);
                return;
            }

            const textBody = typeof body === "string" ? body.trim() : String(body);

            if (textBody.length === 0 || textBody === "null") {
                done(null, undefined);
                return;
            }

            try {
                done(null, JSON.parse(textBody));
            } catch {
                done(null, textBody);
            }
        }
    );

    app.get("/health", async () => ({ status: "ok", service: config.serviceName }));

    app.get("/metrics", async (_, reply) => {
        reply.type("text/plain; version=0.0.4");
        return `service_up{service="${config.serviceName}"} 1\n`;
    });

    app.register(swagger, {
        openapi: {
            info: {
                title: "PhotoX Album Sharing Service API",
                description: "Album CRUD and item membership operations.",
                version: "1.0.0"
            },
            tags: [
                {
                    name: "Albums",
                    description: "Album creation and item management"
                }
            ],
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: "http",
                        scheme: "bearer",
                        bearerFormat: "JWT"
                    }
                }
            }
        }
    });

    app.register(swaggerUi, {
        routePrefix: "/api/v1/albums/docs"
    });

    app.register(openapiRoute);
    app.register(albumRoutes, { prefix: "/api/v1/albums" });

    app.addHook("onReady", async () => {
        if (!overrides.skipMigrations) {
            await runMigrations(db);
        }
    });

    app.addHook("onClose", async () => {
        if (!overrides.db) {
            await db.end();
        }
    });

    app.setErrorHandler((err, request, reply) => {
        if (err instanceof ApiError) {
            reply.code(err.statusCode).send(toErrorBody(err, request.id));
            return;
        }

        request.log.error(err);
        reply
            .code(500)
            .send(toErrorBody(new ApiError(500, "INTERNAL_ERROR", "Internal server error"), request.id));
    });

    return app;
}

module.exports = {
    buildApp
};
