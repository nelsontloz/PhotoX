const fastify = require("fastify")({ logger: true });

const port = Number(process.env.PORT || 3000);
const service = process.env.SERVICE_NAME || "search-service";

fastify.get("/health", async () => ({ status: "ok", service }));

fastify.get("/metrics", async (_, reply) => {
  reply.type("text/plain; version=0.0.4");
  return `service_up{service="${service}"} 1\n`;
});

fastify.listen({ host: "0.0.0.0", port }).catch((err) => {
  fastify.log.error(err);
  process.exit(1);
});
