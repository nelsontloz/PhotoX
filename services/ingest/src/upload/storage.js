const crypto = require("node:crypto");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { finished } = require("node:stream/promises");

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

function toSafeExtension(fileName) {
  const extension = path.extname(fileName || "").toLowerCase();
  if (/^\.[a-z0-9]{1,10}$/.test(extension)) {
    return extension;
  }
  return "";
}

function buildMediaRelativePath({ userId, mediaId, fileName, now = new Date() }) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const extension = toSafeExtension(fileName);
  return `${userId}/${year}/${month}/${mediaId}${extension}`;
}

async function assemblePartsToFile({ originalsRoot, parts, outputRelativePath }) {
  const outputAbsolutePath = path.join(originalsRoot, outputRelativePath);
  await fs.mkdir(path.dirname(outputAbsolutePath), { recursive: true });

  const out = fsSync.createWriteStream(outputAbsolutePath, { flags: "wx" });
  try {
    for (const part of parts) {
      const partAbsolutePath = path.join(originalsRoot, part.relative_part_path);
      const payload = await fs.readFile(partAbsolutePath);
      out.write(payload);
    }
    out.end();
    await finished(out);
    return outputAbsolutePath;
  } catch (err) {
    out.destroy();
    await fs.rm(outputAbsolutePath, { force: true });
    throw err;
  }
}

function checksumFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fsSync.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });
  });
}

module.exports = {
  assemblePartsToFile,
  buildMediaRelativePath,
  checksumSha256,
  checksumFileSha256,
  removeUploadTempDir,
  writeUploadPart
};
