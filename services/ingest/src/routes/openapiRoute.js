module.exports = async function openapiRoute(app) {
  app.get("/api/v1/uploads/openapi.json", async () => app.swagger());
};
