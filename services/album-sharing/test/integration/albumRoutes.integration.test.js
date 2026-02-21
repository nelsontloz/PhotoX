const jwt = require("jsonwebtoken");
const { buildApp } = require("../../src/app");
const mockPool = require("../contracts/mockPool");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ALBUM_ID = "alb_11111111111111111111111111111111";
const MEDIA_ID = "55555555-5555-4555-8555-555555555555";

describe("albumRoutes integration", () => {
    let app;

    beforeAll(async () => {
        app = buildApp({
            jwtAccessSecret: "test-access-secret",
            skipMigrations: true,
            db: mockPool
        });

        await app.ready();
    });

    afterEach(() => {
        mockPool.reset();
    });

    afterAll(async () => {
        mockPool.reset();
        if (app) {
            await app.close();
        }
    });

    it("returns album items with mimeType for playback-aware clients", async () => {
        mockPool.seedAlbum(ALBUM_ID, USER_ID, "Album with video");
        mockPool.seedMedia(MEDIA_ID, USER_ID, "video/mp4");
        mockPool.seedAlbumItem(ALBUM_ID, MEDIA_ID);

        const token = jwt.sign(
            { email: "user@example.com" },
            "test-access-secret",
            { subject: USER_ID }
        );

        const response = await app.inject({
            method: "GET",
            url: `/api/v1/albums/${ALBUM_ID}/items`,
            headers: {
                authorization: `Bearer ${token}`
            }
        });

        expect(response.statusCode).toBe(200);

        const payload = response.json();
        expect(payload.items).toEqual([
            expect.objectContaining({
                mediaId: MEDIA_ID,
                mimeType: "video/mp4"
            })
        ]);
    });
});
