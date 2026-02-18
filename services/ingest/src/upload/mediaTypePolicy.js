const fs = require("node:fs/promises");
const path = require("node:path");

const SUPPORTED_MEDIA_BY_EXTENSION = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".avif", "image/avif"],
  [".heic", "image/heic"],
  [".heif", "image/heif"],
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"],
  [".webm", "video/webm"],
  [".mkv", "video/x-matroska"],
  [".avi", "video/x-msvideo"],
  [".m4v", "video/x-m4v"]
]);

const SUPPORTED_MIME_TYPES = new Set(Array.from(SUPPORTED_MEDIA_BY_EXTENSION.values()));

function normalizeContentType(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .split(";")[0]
    .trim();
}

function getFileExtension(fileName) {
  return path.extname(String(fileName || "").trim().toLowerCase());
}

function isSupportedDeclaredMediaType({ fileName, contentType }) {
  const extension = getFileExtension(fileName);
  const normalizedContentType = normalizeContentType(contentType);
  const expectedMimeType = SUPPORTED_MEDIA_BY_EXTENSION.get(extension);

  if (!expectedMimeType || !SUPPORTED_MIME_TYPES.has(normalizedContentType)) {
    return false;
  }

  return expectedMimeType === normalizedContentType;
}

function detectIsoBmffMimeType(buffer) {
  if (buffer.length < 12) {
    return null;
  }

  if (buffer.toString("ascii", 4, 8) !== "ftyp") {
    return null;
  }

  const majorBrand = buffer.toString("ascii", 8, 12).trim().toLowerCase();
  if (["heic", "heix", "hevc", "hevx"].includes(majorBrand)) {
    return "image/heic";
  }

  if (["mif1", "msf1", "heif"].includes(majorBrand)) {
    return "image/heif";
  }

  if (["avif", "avis"].includes(majorBrand)) {
    return "image/avif";
  }

  if (["qt", "moov"].includes(majorBrand)) {
    return "video/quicktime";
  }

  if (majorBrand === "m4v") {
    return "video/x-m4v";
  }

  return "video/mp4";
}

function detectFromMagicBytes(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (buffer.length >= 6) {
    const gifHeader = buffer.toString("ascii", 0, 6);
    if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
      return "image/gif";
    }
  }

  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }

  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a))
  ) {
    return "image/tiff";
  }

  const isoBmffMimeType = detectIsoBmffMimeType(buffer);
  if (isoBmffMimeType) {
    return isoBmffMimeType;
  }

  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 11) === "AVI") {
    return "video/x-msvideo";
  }

  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    const asciiChunk = buffer.toString("ascii").toLowerCase();
    if (asciiChunk.includes("webm")) {
      return "video/webm";
    }

    return "video/x-matroska";
  }

  return null;
}

async function detectSupportedMimeTypeFromFile(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    const sample = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    if (bytesRead <= 0) {
      return null;
    }

    return detectFromMagicBytes(sample.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

module.exports = {
  SUPPORTED_MEDIA_BY_EXTENSION,
  normalizeContentType,
  getFileExtension,
  isSupportedDeclaredMediaType,
  detectSupportedMimeTypeFromFile
};
