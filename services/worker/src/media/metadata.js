const sharp = require("sharp");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");

let exifReader;
try {
  exifReader = require("exif-reader");
} catch {
  exifReader = null;
}

const execFileAsync = promisify(execFile);

function pickFirstValue(source, keys) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const loweredEntries = Object.entries(source).reduce((acc, [key, value]) => {
    acc[key.toLowerCase()] = value;
    return acc;
  }, {});

  for (const key of keys) {
    const value = loweredEntries[key.toLowerCase()];
    if (value !== undefined && value !== null && String(value).trim().length > 0) {
      return value;
    }
  }

  return null;
}

function parseIsoDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function parseExifDate(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  // Normalize EXIF date separator: "2026:02:17 10:30:00" -> "2026-02-17T10:30:00"
  const normalized = trimmed
    .replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")
    .replace(" ", "T");
  // EXIF dates carry no timezone designator. Treat them as UTC so the value is
  // stable regardless of the server's local timezone offset.
  const alreadyHasTz =
    normalized.endsWith("Z") ||
    /[+-]\d{2}:\d{2}$/.test(normalized);
  const utcString = alreadyHasTz ? normalized : `${normalized}Z`;
  const parsed = new Date(utcString);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function parseRational(value) {
  if (typeof value !== "string") {
    return null;
  }

  if (!value.includes("/")) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const [rawNum, rawDen] = value.split("/");
  const numerator = Number.parseFloat(rawNum);
  const denominator = Number.parseFloat(rawDen);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }

  return numerator / denominator;
}

function parseNumeric(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDms(value) {
  if (typeof value !== "string") {
    return null;
  }

  const match = value
    .trim()
    .match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)?\D*(\d+(?:\.\d+)?)?\D*([NSEW])/i);
  if (!match) {
    return null;
  }

  const degrees = Number.parseFloat(match[1] || "0");
  const minutes = Number.parseFloat(match[2] || "0");
  const seconds = Number.parseFloat(match[3] || "0");
  if (![degrees, minutes, seconds].every((n) => Number.isFinite(n))) {
    return null;
  }

  let decimal = degrees + minutes / 60 + seconds / 3600;
  const direction = (match[4] || "").toUpperCase();
  if (direction === "S" || direction === "W") {
    decimal *= -1;
  }

  return decimal;
}

function parseIso6709(value) {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.trim().match(/^([+-]\d{2}(?:\.\d+)?)([+-]\d{3}(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?\/?$/);
  if (!match) {
    return null;
  }

  const lat = Number.parseFloat(match[1]);
  const lon = Number.parseFloat(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return {
    lat,
    lon
  };
}

/**
 * Parse the raw EXIF buffer returned by sharp into a flat lowercased tag map.
 * Returns an empty object if exif-reader is unavailable or the buffer is invalid.
 */
function parseExifBuffer(exifBuffer) {
  if (!exifReader || !Buffer.isBuffer(exifBuffer) || exifBuffer.length === 0) {
    return {};
  }

  try {
    const parsed = exifReader(exifBuffer);
    const flat = {};

    // Flatten all IFD sub-objects into one lowercased map.
    // Common IFDs: Image (IFD0), Photo (ExifIFD), GPSInfo.
    const sources = [
      parsed?.Image,
      parsed?.Photo,
      parsed?.GPSInfo,
      parsed?.Iop,
      parsed?.ThumbnailIFD
    ];

    for (const source of sources) {
      if (!source || typeof source !== "object") {
        continue;
      }
      for (const [key, value] of Object.entries(source)) {
        if (value !== undefined && value !== null) {
          flat[key.toLowerCase()] = value;
        }
      }
    }

    return flat;
  } catch {
    return {};
  }
}

function extractLocation(tags) {
  const iso = pickFirstValue(tags, ["location", "com.apple.quicktime.location.ISO6709"]);
  const isoLocation = parseIso6709(iso);
  if (isoLocation) {
    return isoLocation;
  }

  const rawLat = pickFirstValue(tags, ["gpslatitude", "latitude", "location_latitude"]);
  const rawLon = pickFirstValue(tags, ["gpslongitude", "longitude", "location_longitude"]);

  const lat = parseNumeric(rawLat) ?? parseDms(rawLat);
  const lon = parseNumeric(rawLon) ?? parseDms(rawLon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return { lat, lon };
}

function selectImageExif(tags) {
  return {
    make: pickFirstValue(tags, ["make"]),
    model: pickFirstValue(tags, ["model"]),
    lensModel: pickFirstValue(tags, ["lensmodel", "lens_model"]),
    exposureTime: pickFirstValue(tags, ["exposuretime", "exposure_time"]),
    fNumber: pickFirstValue(tags, ["fnumber", "f_number"]),
    iso: parseNumeric(pickFirstValue(tags, ["iso", "photographicsensitivity"])),
    focalLength: pickFirstValue(tags, ["focallength", "focal_length"])
  };
}

function selectVideoMetadata({ stream, format }) {
  const fps = parseRational(stream?.avg_frame_rate) ?? parseRational(stream?.r_frame_rate);
  const duration = parseNumeric(format?.duration) ?? parseNumeric(stream?.duration);

  return {
    durationSec: duration,
    codec: stream?.codec_name || null,
    fps,
    bitrate: parseNumeric(format?.bit_rate),
    rotation: parseNumeric(stream?.tags?.rotate)
  };
}

async function probeMedia(sourceAbsolutePath, commandRunner) {
  const { stdout } = await commandRunner("ffprobe", [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-show_entries",
    "format=duration,bit_rate:format_tags:stream=index,codec_type,codec_name,width,height,duration,avg_frame_rate,r_frame_rate:stream_tags",
    "-of",
    "json",
    sourceAbsolutePath
  ]);

  return JSON.parse(stdout || "{}");
}

function buildCaptureTimestamp({ tags, uploadedAt }) {
  const rawTimestamp = pickFirstValue(tags, [
    "datetimeoriginal",
    "creation_time",
    "createdate",
    "date_time_original",
    "com.apple.quicktime.creationdate",
    "datetime"
  ]);

  const parsedTimestamp = parseIsoDate(rawTimestamp) || parseExifDate(rawTimestamp);
  return parsedTimestamp || new Date(uploadedAt).toISOString();
}

async function extractMetadataForImage({ sourceAbsolutePath, uploadedAt, commandRunner }) {
  const imageMeta = await sharp(sourceAbsolutePath).metadata();
  const probe = await probeMedia(sourceAbsolutePath, commandRunner);
  const stream = Array.isArray(probe.streams) ? probe.streams.find((item) => item.codec_type === "video") : null;

  // Parse the raw EXIF IFD buffer from sharp (contains DateTimeOriginal, GPS, etc.)
  // and merge it with ffprobe format/stream tags. ffprobe tags take final priority so
  // explicitly provided container metadata wins; in real JPEGs ffprobe rarely exposes
  // EXIF IFD fields so the EXIF buffer tags will fill in capture date and GPS correctly.
  const exifIfdTags = parseExifBuffer(imageMeta.exif);

  const tags = {
    ...exifIfdTags,
    ...(probe.format?.tags || {}),
    ...(stream?.tags || {})
  };

  const location = extractLocation(tags);
  const imageExif = selectImageExif(tags);

  return {
    takenAt: buildCaptureTimestamp({ tags, uploadedAt }),
    width: imageMeta.width || stream?.width || null,
    height: imageMeta.height || stream?.height || null,
    location,
    exif: {
      image: imageExif
    }
  };
}

async function extractMetadataForVideo({ sourceAbsolutePath, uploadedAt, commandRunner }) {
  const probe = await probeMedia(sourceAbsolutePath, commandRunner);
  const stream = Array.isArray(probe.streams) ? probe.streams.find((item) => item.codec_type === "video") : null;
  if (!stream) {
    throw new Error("Unable to identify video stream for metadata extraction");
  }

  const tags = {
    ...(probe.format?.tags || {}),
    ...(stream.tags || {})
  };

  const location = extractLocation(tags);

  return {
    takenAt: buildCaptureTimestamp({ tags, uploadedAt }),
    width: stream.width || null,
    height: stream.height || null,
    location,
    exif: {
      video: selectVideoMetadata({ stream, format: probe.format || {} })
    }
  };
}

async function extractMediaMetadata({ sourceAbsolutePath, mimeType, uploadedAt, commandRunner = execFileAsync }) {
  const normalizedMimeType = String(mimeType || "").toLowerCase();
  const extension = path.extname(sourceAbsolutePath).toLowerCase();
  const likelyVideo = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"]).has(extension);

  if (normalizedMimeType.startsWith("video/") || (!normalizedMimeType && likelyVideo)) {
    return extractMetadataForVideo({ sourceAbsolutePath, uploadedAt, commandRunner });
  }

  return extractMetadataForImage({ sourceAbsolutePath, uploadedAt, commandRunner });
}

module.exports = {
  extractMediaMetadata
};
