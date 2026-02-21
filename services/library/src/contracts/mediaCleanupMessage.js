function buildMediaCleanupMessage({ mediaId, ownerId, hardDeleteAt }) {
  return {
    mediaId,
    ownerId,
    hardDeleteAt: new Date(hardDeleteAt).toISOString()
  };
}

module.exports = {
  buildMediaCleanupMessage
};
