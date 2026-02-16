module.exports = async function openapiRoute(app) {
  app.get("/api/v1/library/openapi.json", async () => app.swagger());
};
