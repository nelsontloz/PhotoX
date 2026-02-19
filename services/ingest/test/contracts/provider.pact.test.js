const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { Verifier } = require("@pact-foundation/pact");

const { buildApp } = require("../../src/app");
const mockPool = require("./mockPool");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const UPLOAD_ID = "44444444-4444-4444-8444-444444444444";

const CHECKSUM = "de4ecf4e0d0f157c8142fdb7f0e6f9f607c37d9b233830f70f7f83b4f04f9b69";
const PART_SIZE = 5242880;

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

describe("ingest http provider verification", () => {
  let app;
  let tmpDir;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ingest-pact-"));

    const mockQueue = {
      async add() { },
      async close() { }
    };

    app = buildApp({
      jwtAccessSecret: "pact-access-secret",
      db: mockPool,
      mediaProcessQueue: mockQueue,
      uploadOriginalsPath: tmpDir,
      uploadDerivedPath: tmpDir
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

  function seedForInit() {
    mockPool.reset();
  }

  function seedForUploadPart() {
    mockPool.reset();
    mockPool.seedUploadSession({
      id: UPLOAD_ID,
      user_id: USER_ID,
      file_name: "IMG_1024.jpg",
      content_type: "image/jpeg",
      file_size: 3811212,
      checksum_sha256: CHECKSUM,
      part_size: PART_SIZE,
      status: "initiated"
    });
  }

  function seedForReadStatus() {
    mockPool.reset();
    mockPool.seedUploadSession({
      id: UPLOAD_ID,
      user_id: USER_ID,
      file_name: "IMG_1024.jpg",
      content_type: "image/jpeg",
      file_size: 3811212,
      checksum_sha256: CHECKSUM,
      part_size: PART_SIZE,
      status: "uploading"
    });
    mockPool.seedUploadPart({
      upload_id: UPLOAD_ID,
      part_number: 1,
      byte_size: 10,
      checksum_sha256: CHECKSUM,
      relative_part_path: `_tmp/${UPLOAD_ID}/part-1`
    });
  }

  function seedForComplete() {
    mockPool.reset();
    const mediaId = "66666666-6666-4666-8666-666666666666";
    mockPool.seedUploadSession({
      id: UPLOAD_ID,
      user_id: USER_ID,
      file_name: "IMG_1024.jpg",
      content_type: "image/jpeg",
      file_size: 10,
      checksum_sha256: CHECKSUM,
      part_size: PART_SIZE,
      status: "completed",
      media_id: mediaId,
      storage_relative_path: `${USER_ID}/2026/02/${mediaId}.jpg`
    });
  }

  function seedForAbort() {
    mockPool.reset();
    mockPool.seedUploadSession({
      id: UPLOAD_ID,
      user_id: USER_ID,
      file_name: "IMG_1024.jpg",
      content_type: "image/jpeg",
      file_size: 3811212,
      checksum_sha256: CHECKSUM,
      part_size: PART_SIZE,
      status: "uploading"
    });
  }

  it("verifies web consumer pact", async () => {
    const options = {
      provider: "ingest-service",
      providerBaseUrl: `http://127.0.0.1:${app.server.address().port}`,
      providerVersion: process.env.PACT_PROVIDER_APP_VERSION || "local-dev",
      providerVersionBranch: process.env.PACT_CONTRACT_BRANCH || "local",
      enablePending: true,
      publishVerificationResult: !!process.env.PACT_BROKER_BASE_URL,
      stateHandlers: {
        "a user is ready to upload a new 3.8MB JPEG file": async () => {
          seedForInit();
        },
        "an active upload session '44444444-4444-4444-8444-444444444444' exists": async () => {
          seedForUploadPart();
        },
        "an upload '44444444-4444-4444-8444-444444444444' is currently in the 'uploading' state": async () => {
          seedForReadStatus();
        },
        "all parts of the upload '44444444-4444-4444-8444-444444444444' have been successfully stored": async () => {
          seedForComplete();
        },
        "an upload '44444444-4444-4444-8444-444444444444' exists and can be cancelled": async () => {
          seedForAbort();
          // Create temp dir so removeUploadTempDir succeeds
          const partDir = path.join(tmpDir, "_tmp", UPLOAD_ID);
          await fs.mkdir(partDir, { recursive: true });
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
