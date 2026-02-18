function buildMediaDerivativesGenerateMessage({ mediaId, ownerId, relativePath, requestedAt }) {
  return {
    mediaId,
    ownerId,
    relativePath,
    requestedAt: new Date(requestedAt).toISOString()
  };
}

module.exports = {
  buildMediaDerivativesGenerateMessage
};
