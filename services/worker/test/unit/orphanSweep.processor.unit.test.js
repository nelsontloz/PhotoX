const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
    ORIGINALS_SCOPE,
    DERIVED_SCOPE,
    deriveMediaIdFromDerivedRelativePath,
    parseDerivedArtifact,
    createMediaOrphanSweepProcessor
} = require("../../src/orphanSweep/processor");

describe("orphan sweep processor", () => {
    const originalsRoot = path.join(os.tmpdir(), "photox-orphan-sweep-originals-tests");
    const derivedRoot = path.join(os.tmpdir(), "photox-orphan-sweep-derived-tests");

    beforeEach(async () => {
        await fs.rm(originalsRoot, { recursive: true, force: true });
        await fs.rm(derivedRoot, { recursive: true, force: true });
        await fs.mkdir(originalsRoot, { recursive: true });
        await fs.mkdir(derivedRoot, { recursive: true });
    });

    afterAll(async () => {
        await fs.rm(originalsRoot, { recursive: true, force: true });
        await fs.rm(derivedRoot, { recursive: true, force: true });
    });

    it("detects mediaId from derived variant path", () => {
        const mediaId = "55555555-5555-4555-8555-555555555555";
        expect(deriveMediaIdFromDerivedRelativePath(`owner/2026/03/${mediaId}-thumb.webp`)).toBe(mediaId);
        expect(deriveMediaIdFromDerivedRelativePath(`owner/2026/03/${mediaId}-playback.mp4`)).toBe(mediaId);
        expect(deriveMediaIdFromDerivedRelativePath(`owner/2026/03/${mediaId}-poster.webp`)).toBe(mediaId);

        const nonV4MediaId = "88888888-8888-7888-8888-888888888888";
        expect(deriveMediaIdFromDerivedRelativePath(`owner/2026/03/${nonV4MediaId}-thumb.webp`)).toBe(nonV4MediaId);

        expect(deriveMediaIdFromDerivedRelativePath("owner/2026/03/unrelated-file.jpg")).toBeNull();
    });

    it("parses derived artifact details", () => {
        const mediaId = "55555555-5555-4555-8555-555555555555";
        expect(parseDerivedArtifact(`owner/2026/03/${mediaId}-small.webp`)).toMatchObject({
            mediaId,
            variant: "small",
            extension: "webp"
        });
        expect(parseDerivedArtifact(`owner/2026/03/${mediaId}-legacy-thumb.webp`)).toMatchObject({
            mediaId,
            variant: "legacy-thumb",
            extension: "webp"
        });
        expect(parseDerivedArtifact("owner/2026/03/unrelated-file.jpg")).toBeNull();
    });

    it("dry-run scans and reports orphan originals without deleting", async () => {
        const mediaId = "66666666-6666-4666-8666-666666666666";
        const owner = "11111111-1111-4111-8111-111111111111";
        const referencedPath = `${owner}/2026/03/${mediaId}.jpg`;
        const orphanPath = `${owner}/2026/03/orphan.jpg`;

        const referencedAbsolute = path.join(originalsRoot, referencedPath);
        const orphanAbsolute = path.join(originalsRoot, orphanPath);
        await fs.mkdir(path.dirname(referencedAbsolute), { recursive: true });
        await fs.writeFile(referencedAbsolute, "referenced");
        await fs.writeFile(orphanAbsolute, "orphan");

        const mediaRepo = {
            existsByRelativePath: vi.fn(async (relativePath) => relativePath === referencedPath),
            existsById: vi.fn()
        };

        const processor = createMediaOrphanSweepProcessor({
            originalsRoot,
            derivedRoot,
            mediaRepo,
            logger: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn()
            }
        });

        const result = await processor({
            id: "job-orphan-1",
            queueName: "media.orphan.sweep",
            data: {
                scope: ORIGINALS_SCOPE,
                dryRun: true,
                graceMs: 1,
                batchSize: 100
            }
        });

        expect(result.scannedCount).toBe(2);
        expect(result.orphanCandidateCount).toBe(1);
        expect(result.deletedCount).toBe(0);
        await expect(fs.stat(orphanAbsolute)).resolves.toBeTruthy();
    });

    it("deletes old orphan derived files when dryRun is false", async () => {
        const orphanMediaId = "77777777-7777-4777-8777-777777777777";
        const orphanDerivedPath = `owner/2026/03/${orphanMediaId}-thumb.webp`;
        const orphanDerivedAbsolute = path.join(derivedRoot, orphanDerivedPath);

        await fs.mkdir(path.dirname(orphanDerivedAbsolute), { recursive: true });
        await fs.writeFile(orphanDerivedAbsolute, "orphan-derived");

        const mediaRepo = {
            existsByRelativePath: vi.fn(),
            existsById: vi.fn().mockResolvedValue(false),
            findById: vi.fn(async () => null)
        };

        const processor = createMediaOrphanSweepProcessor({
            originalsRoot,
            derivedRoot,
            mediaRepo,
            logger: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn()
            }
        });

        const result = await processor({
            id: "job-orphan-2",
            queueName: "media.orphan.sweep",
            data: {
                scope: DERIVED_SCOPE,
                dryRun: false,
                graceMs: 0,
                batchSize: 100
            }
        });

        expect(result.orphanCandidateCount).toBe(1);
        expect(result.deletedCount).toBe(1);
        await expect(fs.stat(orphanDerivedAbsolute)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("deletes duplicate derived artifacts while keeping canonical variants", async () => {
        const mediaId = "99999999-9999-4999-8999-999999999999";
        const canonicalThumbPath = `owner/2026/03/${mediaId}-thumb.webp`;
        const duplicateLegacyPath = `owner/2026/03/${mediaId}-legacy-thumb.webp`;

        const canonicalThumbAbsolute = path.join(derivedRoot, canonicalThumbPath);
        const duplicateLegacyAbsolute = path.join(derivedRoot, duplicateLegacyPath);

        await fs.mkdir(path.dirname(canonicalThumbAbsolute), { recursive: true });
        await fs.writeFile(canonicalThumbAbsolute, "canonical-thumb");
        await fs.writeFile(duplicateLegacyAbsolute, "duplicate-thumb");

        const mediaRepo = {
            existsByRelativePath: vi.fn(),
            existsById: vi.fn(),
            findById: vi.fn(async () => ({
                id: mediaId,
                relative_path: `owner/2026/03/${mediaId}.jpg`
            }))
        };

        const processor = createMediaOrphanSweepProcessor({
            originalsRoot,
            derivedRoot,
            mediaRepo,
            logger: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn()
            }
        });

        const result = await processor({
            id: "job-orphan-dup-1",
            queueName: "media.orphan.sweep",
            data: {
                scope: DERIVED_SCOPE,
                dryRun: false,
                graceMs: 0,
                batchSize: 100
            }
        });

        expect(result.duplicateDerivedCount).toBe(1);
        expect(result.deletedCount).toBe(1);
        await expect(fs.stat(canonicalThumbAbsolute)).resolves.toBeTruthy();
        await expect(fs.stat(duplicateLegacyAbsolute)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("treats missing scope root as empty and does not fail", async () => {
        await fs.rm(derivedRoot, { recursive: true, force: true });

        const mediaRepo = {
            existsByRelativePath: vi.fn(),
            existsById: vi.fn()
        };

        const processor = createMediaOrphanSweepProcessor({
            originalsRoot,
            derivedRoot,
            mediaRepo,
            logger: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn()
            }
        });

        await expect(
            processor({
                id: "job-orphan-3",
                queueName: "media.orphan.sweep",
                data: {
                    scope: DERIVED_SCOPE,
                    dryRun: true,
                    graceMs: 1,
                    batchSize: 100
                }
            })
        ).resolves.toMatchObject({
            scannedCount: 0,
            orphanCandidateCount: 0,
            deletedCount: 0
        });

        expect(mediaRepo.existsById).not.toHaveBeenCalled();
    });

    it("applies batchSize while traversing without scanning full tree", async () => {
        const owner = "11111111-1111-4111-8111-111111111111";
        const monthDir = path.join(originalsRoot, owner, "2026", "03");
        await fs.mkdir(monthDir, { recursive: true });

        const totalFiles = 8;
        for (let index = 0; index < totalFiles; index += 1) {
            await fs.writeFile(path.join(monthDir, `${String(index).padStart(2, "0")}.jpg`), `orphan-${index}`);
        }

        const mediaRepo = {
            existsByRelativePath: vi.fn().mockResolvedValue(false),
            existsById: vi.fn()
        };

        const processor = createMediaOrphanSweepProcessor({
            originalsRoot,
            derivedRoot,
            mediaRepo,
            logger: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn()
            }
        });

        const result = await processor({
            id: "job-orphan-4",
            queueName: "media.orphan.sweep",
            data: {
                scope: ORIGINALS_SCOPE,
                dryRun: true,
                graceMs: 0,
                batchSize: 3
            }
        });

        expect(result.scannedCount).toBe(3);
        expect(result.orphanCandidateCount).toBe(3);
        expect(mediaRepo.existsByRelativePath).toHaveBeenCalledTimes(3);
    });
});
