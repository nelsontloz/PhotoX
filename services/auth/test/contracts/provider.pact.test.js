const argon2 = require("argon2");
const { Verifier } = require("@pact-foundation/pact");
const { buildApp } = require("../../src/app");
const { hashRefreshToken } = require("../../src/auth/tokens");
const mockPool = require("./mockPool");

// These must match the consumer pact constants exactly.
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_USER_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// This refresh token is the exact value the consumer pact sends.
const CONSUMER_REFRESH_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0eXBlIjoicmVmcmVzaCIsInNpZCI6ImFhYWFhYWFhLWFhYWEtNGFhYS04YWFhLWFhYWFhYWFhYWFhYSIsImV4cCI6NDEwMjQ0NDgwMCwic3ViIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIn0.JJhzvUCbDA7qgUFkINlcrzUKcct8FHajZMug0OnnfS8";

function brokerAuthOptions() {
  if (process.env.PACT_BROKER_TOKEN) {
    return { pactBrokerToken: process.env.PACT_BROKER_TOKEN };
  }

  if (process.env.PACT_BROKER_USERNAME && process.env.PACT_BROKER_PASSWORD) {
    return {
      pactBrokerUsername: process.env.PACT_BROKER_USERNAME,
      pactBrokerPassword: process.env.PACT_BROKER_PASSWORD
    };
  }

  return {};
}

function requireBrokerUrl() {
  const brokerUrl = process.env.PACT_BROKER_BASE_URL;
  if (!brokerUrl) {
    throw new Error("PACT_BROKER_BASE_URL is required for broker-only pact verification");
  }
  return brokerUrl;
}

describe("auth http provider verification", () => {
  let app;
  let loginPasswordHash;
  let dummyPasswordHash;
  let refreshTokenHash;

  beforeAll(async () => {
    // Pre-compute argon2 hashes once (intentionally slow).
    [loginPasswordHash, dummyPasswordHash, refreshTokenHash] = await Promise.all([
      argon2.hash("super-secret-password", { type: argon2.argon2id }),
      argon2.hash("dummy-password-not-used", { type: argon2.argon2id }),
      hashRefreshToken(CONSUMER_REFRESH_TOKEN)
    ]);

    // Boot the Fastify app with the in-memory mock pool — no PostgreSQL needed.
    app = buildApp({
      jwtAccessSecret: "pact-access-secret",
      jwtRefreshSecret: "pact-refresh-secret",
      db: mockPool
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    mockPool.reset();
    if (app) await app.close();
  });

  /**
   * Reset the mock database and seed everything needed for ANY interaction.
   * Called before every interaction via the Verifier `beforeEach` hook.
   */
  function seedDatabase() {
    mockPool.reset();

    // Admin user — matches the access token sub claim (ADMIN_ID).
    mockPool.seedUser({
      id: ADMIN_ID,
      email: "admin@example.com",
      password_hash: dummyPasswordHash,
      is_admin: true,
      is_active: true
    });

    // Regular user for login/refresh — password hash matches "super-secret-password".
    mockPool.seedUser({
      id: USER_ID,
      email: "new-user@example.com",
      password_hash: loginPasswordHash,
      is_admin: false,
      is_active: true
    });

    // Target user for admin management operations.
    mockPool.seedUser({
      id: TARGET_USER_ID,
      email: "managed@example.com",
      password_hash: dummyPasswordHash,
      is_admin: false,
      is_active: true
    });

    // Session for the refresh token interaction.
    mockPool.seedSession({
      id: SESSION_ID,
      user_id: USER_ID,
      refresh_token_hash: refreshTokenHash
    });
  }

  it("verifies web consumer pact", async () => {
    const address = app.server.address();
    const providerBaseUrl = `http://127.0.0.1:${address.port}`;

    const options = {
      provider: "auth-service",
      providerBaseUrl,
      providerVersion: process.env.PACT_PROVIDER_APP_VERSION || "local-dev",
      providerVersionBranch: process.env.PACT_CONTRACT_BRANCH || "local",
      enablePending: true,
      beforeEach: async () => {
        seedDatabase();
      },
      stateHandlers: {
        "register a user": async () => {
          // Register expects "new-user@example.com" to NOT exist.
          mockPool.reset();
          mockPool.seedUser({
            id: ADMIN_ID,
            email: "admin@example.com",
            password_hash: dummyPasswordHash,
            is_admin: true,
            is_active: true
          });
        },
        "login a user": async () => { },
        "refresh auth tokens": async () => { },
        "read current user": async () => { },
        "logout a user": async () => { },
        "list admin users": async () => { },
        "list admin users paginated": async () => { },
        "create admin-managed user": async () => {
          // Admin create user sends "managed@example.com" — remove existing target user.
          mockPool.reset();
          mockPool.seedUser({
            id: ADMIN_ID,
            email: "admin@example.com",
            password_hash: dummyPasswordHash,
            is_admin: true,
            is_active: true
          });
          mockPool.seedUser({
            id: USER_ID,
            email: "new-user@example.com",
            password_hash: loginPasswordHash,
            is_admin: false,
            is_active: true
          });
          mockPool.seedSession({
            id: SESSION_ID,
            user_id: USER_ID,
            refresh_token_hash: refreshTokenHash
          });
        },
        "create admin-managed admin user": async () => {
          // Admin create user sends "managed-admin@example.com" — ensure email does not already exist.
          mockPool.reset();
          mockPool.seedUser({
            id: ADMIN_ID,
            email: "admin@example.com",
            password_hash: dummyPasswordHash,
            is_admin: true,
            is_active: true
          });
          mockPool.seedUser({
            id: USER_ID,
            email: "new-user@example.com",
            password_hash: loginPasswordHash,
            is_admin: false,
            is_active: true
          });
          mockPool.seedSession({
            id: SESSION_ID,
            user_id: USER_ID,
            refresh_token_hash: refreshTokenHash
          });
        },
        "update admin-managed user": async () => { },
        "reactivate managed user": async () => { },
        "reset managed user password": async () => { },
        "disable managed user": async () => { }
      }
    };

    options.pactBrokerUrl = requireBrokerUrl();
    options.consumerVersionSelectors = [{ latest: true, consumer: "photox-web-app" }];
    options.publishVerificationResult = true;
    Object.assign(options, brokerAuthOptions());

    await new Verifier(options).verifyProvider();
  }, 120000);
});
