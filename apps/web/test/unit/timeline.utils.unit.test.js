import { buildNeighborPrefetchTargets } from "../../app/timeline/utils";

describe("timeline prefetch helpers", () => {
    it("selects previous and next media variants around active index", () => {
        const items = [
            { id: "m1", mimeType: "image/jpeg" },
            { id: "m2", mimeType: "image/jpeg" },
            { id: "m3", mimeType: "video/mp4" },
            { id: "m4", mimeType: "image/webp" }
        ];

        expect(buildNeighborPrefetchTargets(items, 2)).toEqual([
            { mediaId: "m2", variant: "small" },
            { mediaId: "m4", variant: "small" }
        ]);
    });

    it("handles edges and invalid index safely", () => {
        const items = [
            { id: "m1", mimeType: "video/webm" },
            { id: "m2", mimeType: "image/jpeg" },
            { id: "m3", mimeType: "video/mp4" }
        ];

        expect(buildNeighborPrefetchTargets(items, 0)).toEqual([
            { mediaId: "m2", variant: "small" }
        ]);
        expect(buildNeighborPrefetchTargets(items, 2)).toEqual([
            { mediaId: "m2", variant: "small" }
        ]);
        expect(buildNeighborPrefetchTargets(items, -1)).toEqual([]);
        expect(buildNeighborPrefetchTargets(items, 99)).toEqual([]);
    });

    it("micro-benchmark: avoids repeated O(N) scans used by legacy neighbor lookup", () => {
        const size = 10_000;
        const loops = 5_000;
        const activeIndex = Math.floor(size / 2);
        const items = Array.from({ length: size }, (_, idx) => ({
            id: `m${idx}`,
            mimeType: idx % 7 === 0 ? "video/mp4" : "image/jpeg"
        }));

        function legacyTargets(sourceItems, index) {
            if (index < 0) return [];

            const neighborIds = [];
            if (index > 0) {
                neighborIds.push(sourceItems[index - 1].id);
            }
            if (index + 1 < sourceItems.length) {
                neighborIds.push(sourceItems[index + 1].id);
            }

            const targets = [];
            for (const mediaId of neighborIds) {
                const media = sourceItems.find((item) => item.id === mediaId);
                const variant = media?.mimeType?.startsWith("video/") ? "playback" : "small";
                targets.push({ mediaId, variant });
            }

            return targets;
        }

        for (let i = 0; i < 300; i += 1) {
            legacyTargets(items, activeIndex);
            buildNeighborPrefetchTargets(items, activeIndex);
        }

        const legacyStart = performance.now();
        for (let i = 0; i < loops; i += 1) {
            legacyTargets(items, activeIndex);
        }
        const legacyMs = performance.now() - legacyStart;

        const optimizedStart = performance.now();
        for (let i = 0; i < loops; i += 1) {
            buildNeighborPrefetchTargets(items, activeIndex);
        }
        const optimizedMs = performance.now() - optimizedStart;

        expect(optimizedMs).toBeLessThan(legacyMs);
    });
});
