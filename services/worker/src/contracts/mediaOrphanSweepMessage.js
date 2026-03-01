function buildMediaOrphanSweepMessage({
    scope,
    dryRun,
    requestedAt,
    requestId,
    graceMs,
    batchSize
}) {
    return {
        scope,
        dryRun: Boolean(dryRun),
        requestedAt: new Date(requestedAt).toISOString(),
        requestId,
        graceMs,
        batchSize
    };
}

module.exports = {
    buildMediaOrphanSweepMessage
};
