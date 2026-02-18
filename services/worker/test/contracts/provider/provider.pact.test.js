const { Verifier } = require("@pact-foundation/pact");

const { buildApp } = require("../../../src/app");
const { WorkerTelemetryStore } = require("../../../src/telemetry/store");

const ADMIN_ID = "22222222-2222-4222-8222-222222222222";

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

describe("worker http provider verification", () => {
  let app;

  beforeAll(async () => {
    const telemetryStore = new WorkerTelemetryStore({
      queueNames: ["media.process", "media.derivatives.generate"]
    });

    app = buildApp({
      jwtAccessSecret: "pact-access-secret",
      db: {
        async query() {
          return { rows: [] };
        },
        async end() { }
      },
      telemetryStore,
      queueStatsPoller: {
        async start() { },
        async close() { },
        getSnapshot() {
          return {
            "media.process": {
              waiting: 0,
              active: 0,
              completed: 0,
              failed: 0,
              delayed: 0
            },
            "media.derivatives.generate": {
              waiting: 0,
              active: 0,
              completed: 0,
              failed: 0,
              delayed: 0
            }
          };
        }
      },
      mediaProcessWorker: { async close() { } },
      mediaDerivativesWorker: { async close() { } }
    });

    app.repos.users.findById = async (id) => {
      if (id === ADMIN_ID) {
        return {
          id: ADMIN_ID,
          is_active: true,
          is_admin: true
        };
      }

      return null;
    };

    await app.ready();
    await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("verifies worker telemetry pact", async () => {
    const options = {
      provider: "worker-service",
      providerBaseUrl: app.server.address() ? `http://127.0.0.1:${app.server.address().port}` : undefined,
      providerVersion: process.env.PACT_PROVIDER_APP_VERSION || "local-dev",
      providerVersionBranch: process.env.PACT_CONTRACT_BRANCH || "local",
      enablePending: true,
      publishVerificationResult: true
    };

    options.pactBrokerUrl = requireBrokerUrl();
    options.consumerVersionSelectors = [{ latest: true, consumer: "photox-web-app" }];
    Object.assign(options, brokerAuthOptions());

    await new Verifier(options).verifyProvider();
  }, 60000);
});
