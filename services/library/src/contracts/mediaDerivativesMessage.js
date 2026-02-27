function buildMediaDerivativesGenerateMessage({
  mediaId,
  ownerId,
  relativePath,
  requestedAt,
  videoEncodingProfileOverride
}) {
  const message = {
    mediaId,
    ownerId,
    relativePath,
    requestedAt: new Date(requestedAt).toISOString()
  };

  if (videoEncodingProfileOverride && typeof videoEncodingProfileOverride === "object") {
    message.videoEncodingProfileOverride = videoEncodingProfileOverride;
  }

  return message;
}

module.exports = {
  buildMediaDerivativesGenerateMessage
};
