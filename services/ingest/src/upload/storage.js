const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

function toPosixRelativePath(fromRoot, targetPath) {
  return path.relative(fromRoot, targetPath).split(path.sep).join("/");
}

function partAbsolutePath(originalsRoot, uploadId, partNumber) {
  return path.join(originalsRoot, "_tmp", uploadId, `part-${partNumber}`);
}

async function writeUploadPart({ originalsRoot, uploadId, partNumber, payload }) {
  const absolutePath = partAbsolutePath(originalsRoot, uploadId, partNumber);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, payload);

  return {
    absolutePath,
    relativePartPath: toPosixRelativePath(originalsRoot, absolutePath)
  };
}

function checksumSha256(payload) {
  return crypto.createHash("sha256").update(payload).digest("hex");
}

async function removeUploadTempDir(originalsRoot, uploadId) {
  const tempDir = path.join(originalsRoot, "_tmp", uploadId);
  await fs.rm(tempDir, { recursive: true, force: true });
}

module.exports = {
  checksumSha256,
  removeUploadTempDir,
  writeUploadPart
};
