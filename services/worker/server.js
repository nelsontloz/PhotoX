const { buildApp } = require("./src/app");

const app = buildApp();

app.listen({ host: "0.0.0.0", port: app.config.port }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
