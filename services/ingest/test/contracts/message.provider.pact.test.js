const { MessageProviderPact } = require("@pact-foundation/pact");

const { buildMediaProcessMessage } = require("../../src/contracts/mediaProcessMessage");

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

describe("ingest message provider verification", () => {
  it("verifies media.process message pact", async () => {
    const options = {
      provider: "ingest-service",
      providerVersion: process.env.PACT_PROVIDER_APP_VERSION || "local-dev",
      providerVersionBranch: process.env.PACT_CONTRACT_BRANCH || "local",
      publishVerificationResult: !!process.env.PACT_BROKER_BASE_URL,
      messageProviders: {
        "a command to process a newly uploaded media file": async () =>
          buildMediaProcessMessage({
            mediaId: "55555555-5555-4555-8555-555555555555",
            ownerId: "11111111-1111-4111-8111-111111111111",
            relativePath: "11111111-1111-4111-8111-111111111111/2026/02/55555555-5555-4555-8555-555555555555.jpg",
            checksumSha256: "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69",
            uploadedAt: "2026-02-18T12:00:00.000Z"
          })
      }
    };

    if (process.env.PACT_URL) {
      options.pactUrls = [process.env.PACT_URL];
    } else {
      options.pactBrokerUrl = requireBrokerUrl();
      options.consumerVersionSelectors = [{ latest: true, consumer: "worker-service" }];
      Object.assign(options, brokerAuthOptions());
    }

    const verifier = new MessageProviderPact(options);
    await verifier.verify();
  });
});
