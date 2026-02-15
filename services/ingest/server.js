const fastify = require("fastify")({ logger: true });
const swagger = require("@fastify/swagger");
const swaggerUi = require("@fastify/swagger-ui");

const port = Number(process.env.PORT || 3000);
const service = process.env.SERVICE_NAME || "ingest-service";

fastify.register(swagger, {
  openapi: {
    info: {
      title: "PhotoX Ingest Service API",
      version: "1.0.0"
    }
  }
});

fastify.register(swaggerUi, {
  routePrefix: "/api/v1/uploads/docs"
});

fastify.get("/health", async () => ({ status: "ok", service }));

fastify.get("/metrics", async (_, reply) => {
  reply.type("text/plain; version=0.0.4");
  return `service_up{service="${service}"} 1\n`;
});

fastify.get("/api/v1/uploads/openapi.json", async () => fastify.swagger());

fastify.listen({ host: "0.0.0.0", port }).catch((err) => {
  fastify.log.error(err);
  process.exit(1);
});
