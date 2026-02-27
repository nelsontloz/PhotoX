const { MessageProviderPact } = require("@pact-foundation/pact");

const { buildMediaDerivativesGenerateMessage } = require("../../src/contracts/mediaDerivativesMessage");
const { buildMediaCleanupMessage } = require("../../src/contracts/mediaCleanupMessage");

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

describe("library message provider verification", () => {
  it("verifies media.derivatives.generate message pact", async () => {
    const options = {
      provider: "library-service",
      providerVersion: process.env.PACT_PROVIDER_APP_VERSION || "local-dev",
      publishVerificationResult: !!process.env.PACT_BROKER_BASE_URL,
      messageProviders: {
        "a command to generate thumbnails and variants for a media item": async () =>
          buildMediaDerivativesGenerateMessage({
            mediaId: "55555555-5555-4555-8555-555555555555",
            ownerId: "11111111-1111-4111-8111-111111111111",
            relativePath: "11111111-1111-4111-8111-111111111111/2026/02/55555555-5555-4555-8555-555555555555.jpg",
            requestedAt: "2026-02-18T12:00:10.000Z",
            videoEncodingProfileOverride: {
              codec: "libvpx-vp9",
              resolution: "1280x720",
              bitrateKbps: 1800,
              frameRate: 24,
              audioCodec: "libopus",
              audioBitrateKbps: 96,
              preset: "fast",
              outputFormat: "webm"
            }
          }),
        "a command to permanently delete a soft-deleted media item": async () =>
          buildMediaCleanupMessage({
            mediaId: "55555555-5555-4555-8555-555555555555",
            ownerId: "11111111-1111-4111-8111-111111111111",
            hardDeleteAt: "2026-03-20T12:00:00.000Z"
          })
      }
    };

    if (process.env.PACT_CONTRACT_BRANCH) {
      options.providerVersionBranch = process.env.PACT_CONTRACT_BRANCH;
    }

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
