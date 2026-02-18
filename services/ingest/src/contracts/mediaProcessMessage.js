function buildMediaProcessMessage({ mediaId, ownerId, relativePath, checksumSha256, uploadedAt }) {
  return {
    mediaId,
    ownerId,
    relativePath,
    checksumSha256,
    uploadedAt: new Date(uploadedAt).toISOString()
  };
}

module.exports = {
  buildMediaProcessMessage
};
