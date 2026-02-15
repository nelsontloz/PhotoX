module.exports = async function openapiRoute(app) {
  app.get("/openapi.json", async () => ({
    openapi: "3.0.3",
    info: {
      title: "PhotoX Auth Service API",
      version: "1.0.0"
    },
    paths: {
      "/api/v1/auth/register": {
        post: {
          summary: "Register user",
          responses: {
            "201": { description: "Created" },
            "409": { description: "Duplicate email" }
          }
        }
      },
      "/api/v1/auth/login": {
        post: {
          summary: "Login user",
          responses: {
            "200": { description: "Authenticated" },
            "401": { description: "Invalid credentials" }
          }
        }
      },
      "/api/v1/auth/refresh": {
        post: {
          summary: "Refresh token pair",
          responses: {
            "200": { description: "Token pair rotated" },
            "401": { description: "Invalid refresh token" }
          }
        }
      },
      "/api/v1/auth/logout": {
        post: {
          summary: "Revoke refresh session",
          responses: {
            "200": { description: "Session revoked" }
          }
        }
      },
      "/api/v1/me": {
        get: {
          summary: "Get current user",
          responses: {
            "200": { description: "Current user profile" },
            "401": { description: "Invalid access token" }
          }
        }
      }
    }
  }));
};
