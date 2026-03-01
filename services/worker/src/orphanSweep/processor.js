const fs = require("node:fs/promises");
const path = require("node:path");

const { buildDerivativeRelativePath, resolveAbsolutePath } = require("../media/paths");

const ORIGINALS_SCOPE = "originals";
const DERIVED_SCOPE = "derived";

function normalizeForStorage(relativePath) {
    return String(relativePath || "").split(path.sep).join("/");
}

function isMediaIdToken(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function deriveMediaIdFromDerivedRelativePath(relativePath) {
    const normalized = normalizeForStorage(relativePath);
    const base = path.posix.basename(normalized);

    const suffixMatch = base.match(/^([0-9a-f-]{36})-(thumb|small|playback)\.(webp|webm|mp4)$/i);
    if (suffixMatch && isMediaIdToken(suffixMatch[1])) {
        return suffixMatch[1].toLowerCase();
    }

    const legacyMatch = base.match(/^([0-9a-f-]{36})-[^.]+\.[^./]+$/i);
    if (legacyMatch && isMediaIdToken(legacyMatch[1])) {
        return legacyMatch[1].toLowerCase();
    }

    return null;
}

function parseDerivedArtifact(relativePath) {
    const normalized = normalizeForStorage(relativePath);
    const base = path.posix.basename(normalized);

    const canonicalMatch = base.match(/^([0-9a-f-]{36})-(thumb|small|playback)\.(webp|webm|mp4)$/i);
    if (canonicalMatch && isMediaIdToken(canonicalMatch[1])) {
        return {
            mediaId: canonicalMatch[1].toLowerCase(),
            variant: canonicalMatch[2].toLowerCase(),
            extension: canonicalMatch[3].toLowerCase()
        };
    }

    const legacyMatch = base.match(/^([0-9a-f-]{36})-([^.]+)\.([^./]+)$/i);
    if (legacyMatch && isMediaIdToken(legacyMatch[1])) {
        return {
            mediaId: legacyMatch[1].toLowerCase(),
            variant: legacyMatch[2].toLowerCase(),
            extension: legacyMatch[3].toLowerCase()
        };
    }

    return null;
}

function buildCanonicalDerivedPathSet(media) {
    const mediaId = String(media?.id || "").toLowerCase();
    const relativePath = normalizeForStorage(media?.relative_path || "");

    return new Set([
        normalizeForStorage(buildDerivativeRelativePath(relativePath, mediaId, "thumb", "webp")),
        normalizeForStorage(buildDerivativeRelativePath(relativePath, mediaId, "small", "webp")),
        normalizeForStorage(buildDerivativeRelativePath(relativePath, mediaId, "playback", "webm")),
        normalizeForStorage(buildDerivativeRelativePath(relativePath, mediaId, "playback", "mp4"))
    ]);
}

async function listFilesRecursive(rootAbsolutePath, limit = Number.POSITIVE_INFINITY) {
    const collected = [];

    async function walk(currentAbsolutePath, currentRelativePath) {
        if (collected.length >= limit) {
            return;
        }

        let entries;
        try {
            entries = await fs.readdir(currentAbsolutePath, { withFileTypes: true });
        } catch (err) {
            if (err?.code === "ENOENT") {
                return;
            }
            throw err;
        }

        entries.sort((a, b) => a.name.localeCompare(b.name));

        for (const entry of entries) {
            if (collected.length >= limit) {
                break;
            }

            const entryRelativePath = currentRelativePath ? `${currentRelativePath}/${entry.name}` : entry.name;
            const entryAbsolutePath = resolveAbsolutePath(rootAbsolutePath, entryRelativePath);
            if (entry.isDirectory()) {
                await walk(entryAbsolutePath, entryRelativePath);
            } else if (entry.isFile()) {
                collected.push({
                    relativePath: normalizeForStorage(entryRelativePath),
                    absolutePath: entryAbsolutePath
                });
            }
        }
    }

    await walk(rootAbsolutePath, "");
    return collected;
}

async function fileOlderThanGrace(absolutePath, graceMs, nowMs) {
    const stat = await fs.stat(absolutePath);
    return nowMs - stat.mtimeMs >= graceMs;
}

function createMediaOrphanSweepProcessor({ originalsRoot, derivedRoot, mediaRepo, logger }) {
    return async (job) => {
        const {
            scope,
            dryRun = true,
            graceMs = 6 * 60 * 60 * 1000,
            batchSize = 1000,
            requestId = null,
            trigger = null
        } = job.data || {};

        if (![ORIGINALS_SCOPE, DERIVED_SCOPE].includes(scope)) {
            throw new Error("Invalid orphan sweep payload: scope must be 'originals' or 'derived'");
        }

        const rootPath = scope === ORIGINALS_SCOPE ? originalsRoot : derivedRoot;
        const rootAbsolutePath = path.resolve(rootPath);
        const nowMs = Date.now();
        const maxItems = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 1000;

        const files = await listFilesRecursive(rootAbsolutePath, maxItems);
        let scannedCount = 0;
        let orphanCandidateCount = 0;
        let deletedCount = 0;
        let skippedRecentCount = 0;
        let skippedReferencedCount = 0;
        let duplicateDerivedCount = 0;
        const sampledDeletes = [];
        const mediaById = new Map();
        const canonicalDerivedPathSetByMediaId = new Map();

        for (const entry of files) {
            scannedCount += 1;
            let referenced = false;

            if (scope === ORIGINALS_SCOPE) {
                referenced = await mediaRepo.existsByRelativePath(entry.relativePath);
            } else {
                const artifact = parseDerivedArtifact(entry.relativePath);
                if (!artifact?.mediaId) {
                    referenced = true;
                } else {
                    let media = mediaById.get(artifact.mediaId);
                    if (media === undefined) {
                        media = await mediaRepo.findById(artifact.mediaId);
                        mediaById.set(artifact.mediaId, media || null);
                    }

                    if (!media) {
                        referenced = false;
                    } else {
                        let canonicalPathSet = canonicalDerivedPathSetByMediaId.get(artifact.mediaId);
                        if (!canonicalPathSet) {
                            canonicalPathSet = buildCanonicalDerivedPathSet(media);
                            canonicalDerivedPathSetByMediaId.set(artifact.mediaId, canonicalPathSet);
                        }

                        referenced = canonicalPathSet.has(entry.relativePath);
                        if (!referenced) {
                            duplicateDerivedCount += 1;
                        }
                    }
                }
            }

            if (referenced) {
                skippedReferencedCount += 1;
                continue;
            }

            const oldEnough = await fileOlderThanGrace(entry.absolutePath, graceMs, nowMs);
            if (!oldEnough) {
                skippedRecentCount += 1;
                continue;
            }

            orphanCandidateCount += 1;
            if (!dryRun) {
                try {
                    await fs.unlink(entry.absolutePath);
                    deletedCount += 1;
                    if (sampledDeletes.length < 25) {
                        sampledDeletes.push(entry.relativePath);
                    }
                } catch (err) {
                    if (err?.code !== "ENOENT") {
                        throw err;
                    }
                }
            }
        }

        logger.info(
            {
                queueName: job.queueName,
                jobId: job.id,
                requestId,
                trigger,
                scope,
                dryRun,
                scannedCount,
                orphanCandidateCount,
                deletedCount,
                skippedRecentCount,
                skippedReferencedCount,
                duplicateDerivedCount,
                sampledDeletes
            },
            "orphan sweep completed"
        );

        return {
            scope,
            dryRun,
            scannedCount,
            orphanCandidateCount,
            deletedCount,
            skippedRecentCount,
            skippedReferencedCount,
            duplicateDerivedCount
        };
    };
}

module.exports = {
    ORIGINALS_SCOPE,
    DERIVED_SCOPE,
    normalizeForStorage,
    deriveMediaIdFromDerivedRelativePath,
    parseDerivedArtifact,
    createMediaOrphanSweepProcessor
};
