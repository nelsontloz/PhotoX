const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { Verifier } = require("@pact-foundation/pact");

const { buildApp } = require("../../src/app");
const mockPool = require("./mockPool");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const MEDIA_ID = "55555555-5555-4555-8555-555555555555";
const RELATIVE_PATH = `${USER_ID}/2026/02/${MEDIA_ID}.jpg`;
const VIDEO_RELATIVE_PATH = `${USER_ID}/2026/02/${MEDIA_ID}.mp4`;

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

describe("library http provider verification", () => {
  let app;
  let tmpDir;
  let derivedDir;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "library-pact-"));
    derivedDir = path.join(tmpDir, "derived");
    await fs.mkdir(derivedDir, { recursive: true });

    const mockQueue = {
      async add() { },
      async close() { }
    };

    app = buildApp({
      jwtAccessSecret: "pact-access-secret",
      db: mockPool,
      mediaDerivativesQueue: mockQueue,
      uploadOriginalsPath: path.join(tmpDir, "originals"),
      uploadDerivedPath: derivedDir
    });

    await app.ready();
    await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    mockPool.reset();
    if (app) await app.close();
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
    }
  });

  function seedMediaRow() {
    mockPool.reset();
    mockPool.seedMedia({
      id: MEDIA_ID,
      owner_id: USER_ID,
      relative_path: RELATIVE_PATH,
      mime_type: "image/jpeg",
      status: "ready"
    });
  }

  function seedVideoMediaRow() {
    mockPool.reset();
    mockPool.seedMedia({
      id: MEDIA_ID,
      owner_id: USER_ID,
      relative_path: VIDEO_RELATIVE_PATH,
      mime_type: "video/mp4",
      status: "ready"
    });
  }

  async function seedDerivativeFile(variant = "thumb") {
    // Create the derivative WebP file so the content endpoint can serve it.
    // Derivative path: {derivedDir}/{userId}/2026/02/{mediaId}-{variant}.webp
    const dir = path.join(derivedDir, USER_ID, "2026", "02");
    await fs.mkdir(dir, { recursive: true });
    // Minimal 1x1 WebP — "RIFF" header + minimal content
    const webpBytes = Buffer.from(
      "524946462400000057454250565038200a000000300100009001002a0100010001200025a40003700000feef94000000",
      "hex"
    );
    await fs.writeFile(path.join(dir, `${MEDIA_ID}-${variant}.webp`), webpBytes);
  }

  async function seedPlaybackFile() {
    // Minimal WebM header bytes for pact content-type assertion path.
    const dir = path.join(derivedDir, USER_ID, "2026", "02");
    await fs.mkdir(dir, { recursive: true });
    const webmBytes = Buffer.from("1a45dfa3", "hex");
    await fs.writeFile(path.join(dir, `${MEDIA_ID}-playback.webm`), webmBytes);
  }

  it("verifies web consumer pact", async () => {
    const options = {
      provider: "library-service",
      providerBaseUrl: `http://127.0.0.1:${app.server.address().port}`,
      providerVersion: process.env.PACT_PROVIDER_APP_VERSION || "local-dev",
      providerVersionBranch: process.env.PACT_CONTRACT_BRANCH || "local",
      enablePending: true,
      publishVerificationResult: !!process.env.PACT_BROKER_BASE_URL,
      stateHandlers: {
        "there are media items in the user's library": async () => {
          seedMediaRow();
        },
        "there are media items matching the search criteria 'beach'": async () => {
          seedMediaRow();
        },
        "a media item exists with ID '55555555-5555-4555-8555-555555555555'": async () => {
          seedMediaRow();
        },
        "a media item exists to have its flags updated": async () => {
          seedMediaRow();
        },
        "a thumbnail variant exists for media '55555555-5555-4555-8555-555555555555'": async () => {
          seedMediaRow();
          await seedDerivativeFile("thumb");
        },
        "a small variant exists for media '55555555-5555-4555-8555-555555555555'": async () => {
          seedMediaRow();
          await seedDerivativeFile("small");
        },
        "a playback variant exists for video '55555555-5555-4555-8555-555555555555'": async () => {
          seedVideoMediaRow();
          await seedPlaybackFile();
        },
        "a media item exists to be soft-deleted": async () => {
          seedMediaRow();
        },
        "a soft-deleted media item exists to be restored": async () => {
          seedMediaRow();
        }
      }
    };

    if (process.env.PACT_URL) {
      options.pactUrls = [process.env.PACT_URL];
    } else {
      options.pactBrokerUrl = requireBrokerUrl();
      options.consumerVersionSelectors = [{ latest: true, consumer: "photox-web-app" }];
      Object.assign(options, brokerAuthOptions());
    }

    await new Verifier(options).verifyProvider();
  }, 60000);
});
