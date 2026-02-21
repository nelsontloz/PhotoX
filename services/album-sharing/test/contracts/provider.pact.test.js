const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { Verifier } = require("@pact-foundation/pact");

const { buildApp } = require("../../src/app");
const mockPool = require("./mockPool");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const MEDIA_ID = "55555555-5555-4555-8555-555555555555";
const ALBUM_ID = "alb_11111111111111111111111111111111";

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

describe("album sharing http provider verification", () => {
    let app;
    let tmpDir;

    beforeAll(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "album-pact-"));

        app = buildApp({
            jwtAccessSecret: "pact-access-secret",
            skipMigrations: true,
            db: mockPool
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

    it("verifies web consumer pact", async () => {
        const options = {
            provider: "album-sharing-service",
            providerBaseUrl: `http://127.0.0.1:${app.server.address().port}`,
            providerVersion: process.env.PACT_PROVIDER_APP_VERSION || "local-dev",
            providerVersionBranch: process.env.PACT_CONTRACT_BRANCH || "local",
            enablePending: true,
            publishVerificationResult: !!process.env.PACT_BROKER_BASE_URL,
            stateHandlers: {
                "a user exists and is ready to create an album": async () => {
                    mockPool.reset();
                },
                "the user has created albums": async () => {
                    mockPool.reset();
                    mockPool.seedAlbum(ALBUM_ID, USER_ID, "Summer Vacation 2026");
                },
                "an album 'alb_11111111111111111111111111111111' exists for the user and media '55555555-5555-4555-8555-555555555555' is owned by the user": async () => {
                    mockPool.reset();
                    mockPool.seedAlbum(ALBUM_ID, USER_ID, "Summer Vacation 2026");
                    mockPool.seedMedia(MEDIA_ID, USER_ID);
                },
                "an album 'alb_11111111111111111111111111111111' exists with items inside": async () => {
                    mockPool.reset();
                    mockPool.seedAlbum(ALBUM_ID, USER_ID, "Summer Vacation 2026");
                    mockPool.seedMedia(MEDIA_ID, USER_ID, "video/mp4");
                    mockPool.seedAlbumItem(ALBUM_ID, MEDIA_ID);
                },
                "an album 'alb_11111111111111111111111111111111' exists for the user": async () => {
                    mockPool.reset();
                    mockPool.seedAlbum(ALBUM_ID, USER_ID, "Summer Vacation 2026");
                    mockPool.seedAlbumItem(ALBUM_ID, MEDIA_ID);
                },
                "an album 'alb_11111111111111111111111111111111' exists for the user and contains media '55555555-5555-4555-8555-555555555555'": async () => {
                    mockPool.reset();
                    mockPool.seedAlbum(ALBUM_ID, USER_ID, "Summer Vacation 2026");
                    mockPool.seedAlbumItem(ALBUM_ID, MEDIA_ID);
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
