const { buildAlbumRepo } = require("../../src/repos/albumRepo");

describe("albumRepo", () => {
    it("should list albums", async () => {
        const mockDb = {
            query: vi.fn().mockResolvedValue({
                rows: [{ id: "alb_1", owner_id: "user_1", title: "Test", created_at: "2026-02-18T12:00:00.000Z", updated_at: "2026-02-18T12:00:00.000Z" }]
            })
        };
        const repo = buildAlbumRepo(mockDb);

        const items = await repo.listAlbums({ ownerId: "user_1" });
        expect(items).toHaveLength(1);
        expect(items[0].id).toBe("alb_1");
        expect(mockDb.query).toHaveBeenCalledTimes(1);
    });
});
