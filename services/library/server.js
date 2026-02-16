const { buildApp } = require("./src/app");

async function start() {
  const app = buildApp();
  await app.listen({ host: "0.0.0.0", port: app.config.port });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
