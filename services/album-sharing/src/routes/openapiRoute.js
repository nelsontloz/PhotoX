module.exports = async function openapiRoute(app) {
    app.get("/api/v1/albums/openapi.json", async () => app.swagger());
};
