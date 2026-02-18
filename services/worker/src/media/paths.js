const path = require("node:path");

function normalizeRelativePath(relativePath) {
  return relativePath.split("/").join(path.sep);
}

function resolveAbsolutePath(rootPath, relativePath) {
  const root = path.resolve(rootPath);
  const absolutePath = path.resolve(root, normalizeRelativePath(relativePath));

  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Resolved path escapes root directory");
  }

  return absolutePath;
}

function buildDerivativeRelativePath(mediaRelativePath, mediaId, variant, extension = "webp") {
  const normalized = mediaRelativePath.split("\\").join("/");
  const directory = path.posix.dirname(normalized);
  return `${directory}/${mediaId}-${variant}.${extension}`;
}

module.exports = {
  buildDerivativeRelativePath,
  resolveAbsolutePath
};
