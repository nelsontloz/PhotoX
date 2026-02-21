const { buildAlbumRepo } = require("../../src/repos/albumRepo");

describe("albumRepo", () => {
    it("should list albums with mediaCount", async () => {
        const mockDb = {
            query: vi.fn().mockResolvedValue({
                rows: [{ id: "alb_1", ownerId: "user_1", title: "Test", createdAt: "2026-02-18T12:00:00.000Z", updatedAt: "2026-02-18T12:00:00.000Z", mediaCount: 3 }]
            })
        };
        const repo = buildAlbumRepo(mockDb);

        const items = await repo.listAlbums({ ownerId: "user_1" });
        expect(items).toHaveLength(1);
        expect(items[0].id).toBe("alb_1");
        expect(items[0].mediaCount).toBe(3);
        expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it("should return getAlbumWithItemCount for the owner", async () => {
        const mockDb = {
            query: vi.fn().mockResolvedValue({
                rowCount: 1,
                rows: [{ id: "alb_1", ownerId: "user_1", title: "Test", createdAt: "2026-02-18T12:00:00.000Z", updatedAt: "2026-02-18T12:00:00.000Z", mediaCount: 5 }]
            })
        };
        const repo = buildAlbumRepo(mockDb);

        const album = await repo.getAlbumWithItemCount({ albumId: "alb_1", ownerId: "user_1" });
        expect(album.id).toBe("alb_1");
        expect(album.mediaCount).toBe(5);
    });

    it("should throw 403 from getAlbumWithItemCount when not the owner", async () => {
        const mockDb = {
            query: vi.fn().mockResolvedValue({
                rowCount: 1,
                rows: [{ id: "alb_1", ownerId: "user_1", title: "Test", createdAt: "2026-02-18T12:00:00.000Z", updatedAt: "2026-02-18T12:00:00.000Z", mediaCount: 0 }]
            })
        };
        const repo = buildAlbumRepo(mockDb);

        await expect(repo.getAlbumWithItemCount({ albumId: "alb_1", ownerId: "other_user" }))
            .rejects.toMatchObject({ statusCode: 403, code: "ALBUM_FORBIDDEN" });
    });

    it("should removeMediaFromAlbum successfully", async () => {
        const mockDb = {
            query: vi.fn()
                // First call: getAlbumById
                .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "alb_1", ownerId: "user_1", title: "T", createdAt: null, updatedAt: null }] })
                // Second call: DELETE
                .mockResolvedValueOnce({ rowCount: 1 })
        };
        const repo = buildAlbumRepo(mockDb);

        const result = await repo.removeMediaFromAlbum({ albumId: "alb_1", ownerId: "user_1", mediaId: "med_1" });
        expect(result).toEqual({ albumId: "alb_1", mediaId: "med_1" });
    });

    it("should throw 404 from removeMediaFromAlbum when item not in album", async () => {
        const mockDb = {
            query: vi.fn()
                .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "alb_1", ownerId: "user_1", title: "T", createdAt: null, updatedAt: null }] })
                .mockResolvedValueOnce({ rowCount: 0 })
        };
        const repo = buildAlbumRepo(mockDb);

        await expect(repo.removeMediaFromAlbum({ albumId: "alb_1", ownerId: "user_1", mediaId: "med_999" }))
            .rejects.toMatchObject({ statusCode: 404, code: "ALBUM_ITEM_NOT_FOUND" });
    });
});
