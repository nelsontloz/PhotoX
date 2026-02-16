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

function toPosixRelativePath(fromRoot, targetPath) {
  return path.relative(fromRoot, targetPath).split(path.sep).join("/");
}

function buildDerivativeRelativePath(mediaRelativePath, mediaId, variant) {
  const normalized = mediaRelativePath.split("\\").join("/");
  const directory = path.posix.dirname(normalized);
  return `${directory}/${mediaId}-${variant}.webp`;
}

module.exports = {
  buildDerivativeRelativePath,
  resolveAbsolutePath,
  toPosixRelativePath
};
