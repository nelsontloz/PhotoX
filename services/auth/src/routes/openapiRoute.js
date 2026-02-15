module.exports = async function openapiRoute(app) {
  app.get("/api/v1/auth/openapi.json", async () => app.swagger());
};
