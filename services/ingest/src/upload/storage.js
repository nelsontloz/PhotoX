const crypto = require("node:crypto");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { finished, pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");

function toPosixRelativePath(fromRoot, targetPath) {
  return path.relative(fromRoot, targetPath).split(path.sep).join("/");
}

function partAbsolutePath(originalsRoot, uploadId, partNumber) {
  return path.join(originalsRoot, "_tmp", uploadId, `part-${partNumber}`);
}

async function writeUploadPart({ originalsRoot, uploadId, partNumber, payloadStream, maxSize }) {
  const absolutePath = partAbsolutePath(originalsRoot, uploadId, partNumber);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });

  const writeStream = fsSync.createWriteStream(absolutePath);
  const hash = crypto.createHash("sha256");
  let bytesWritten = 0;

  const transform = new Transform({
    transform(chunk, encoding, callback) {
      bytesWritten += chunk.length;
      if (maxSize && bytesWritten > maxSize) {
        callback(new Error("UPLOAD_PART_TOO_LARGE"));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    }
  });

  try {
    await pipeline(payloadStream, transform, writeStream);
  } catch (err) {
    // If we aborted due to size, clean up the partial file
    await fs.rm(absolutePath, { force: true });
    throw err;
  }

  return {
    absolutePath,
    relativePartPath: toPosixRelativePath(originalsRoot, absolutePath),
    checksumSha256: hash.digest("hex"),
    bytesWritten
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
      const input = fsSync.createReadStream(partAbsolutePath);
      await new Promise((resolve, reject) => {
        input.pipe(out, { end: false });
        input.on("error", (err) => reject(err));
        input.on("end", () => resolve());
      });
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
    stream.pipe(hash);
    stream.on("error", reject);
    hash.on("finish", () => resolve(hash.digest("hex")));
    hash.on("error", reject);
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
