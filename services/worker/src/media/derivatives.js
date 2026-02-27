const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const sharp = require("sharp");

const { buildDerivativeRelativePath, resolveAbsolutePath } = require("./paths");
const { buildPlaybackFfmpegArgs } = require("../videoEncoding/profile");

const execFileAsync = promisify(execFile);

function buildDescriptor({ variant, derivativeRelativePath, derivativeAbsolutePath }) {
  return {
    variant,
    relativePath: derivativeRelativePath,
    absolutePath: derivativeAbsolutePath
  };
}

function variantTransform(image, variant) {
  if (variant === "thumb") {
    return image.resize(320, 320, {
      fit: "cover",
      position: "centre"
    });
  }

  if (variant === "small") {
    return image.resize({
      width: 1280,
      height: 1280,
      fit: "inside",
      withoutEnlargement: true
    });
  }

  throw new Error(`Unsupported derivative variant: ${variant}`);
}

async function writeDerivative({ originalsRoot, derivedRoot, mediaId, relativePath, variant }) {
  const sourceAbsolutePath = resolveAbsolutePath(originalsRoot, relativePath);
  const derivativeRelativePath = buildDerivativeRelativePath(relativePath, mediaId, variant);
  const derivativeAbsolutePath = resolveAbsolutePath(derivedRoot, derivativeRelativePath);

  await fs.mkdir(path.dirname(derivativeAbsolutePath), { recursive: true });
  const pipeline = variantTransform(sharp(sourceAbsolutePath).rotate(), variant);
  await pipeline.webp({ quality: 82 }).toFile(derivativeAbsolutePath);

  return buildDescriptor({ variant, derivativeRelativePath, derivativeAbsolutePath });
}

function isImageFile(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  return new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".tif",
    ".tiff",
    ".avif",
    ".heic",
    ".heif"
  ]).has(extension);
}

async function probeVideoStream(sourceAbsolutePath, commandRunner) {
  const { stdout } = await commandRunner("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-select_streams",
    "v",
    "-of",
    "json",
    sourceAbsolutePath
  ]);

  const parsed = JSON.parse(stdout || "{}");
  return Array.isArray(parsed.streams) && parsed.streams.length > 0;
}

async function detectInputType({ sourceAbsolutePath, relativePath, commandRunner }) {
  if (isImageFile(relativePath)) {
    return "image";
  }

  const hasVideoStream = await probeVideoStream(sourceAbsolutePath, commandRunner);
  if (hasVideoStream) {
    return "video";
  }

  throw new Error(`Unsupported media type for derivative generation: ${relativePath}`);
}

function getVideoPosterFilter(variant) {
  if (variant === "thumb") {
    return "thumbnail,scale=320:320:force_original_aspect_ratio=increase,crop=320:320";
  }

  if (variant === "small") {
    return "thumbnail,scale=1280:1280:force_original_aspect_ratio=decrease";
  }

  throw new Error(`Unsupported video poster variant: ${variant}`);
}

async function writeVideoPosterDerivative({
  sourceAbsolutePath,
  derivedRoot,
  mediaId,
  relativePath,
  variant,
  commandRunner
}) {
  const derivativeRelativePath = buildDerivativeRelativePath(relativePath, mediaId, variant);
  const derivativeAbsolutePath = resolveAbsolutePath(derivedRoot, derivativeRelativePath);
  await fs.mkdir(path.dirname(derivativeAbsolutePath), { recursive: true });

  await commandRunner("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    sourceAbsolutePath,
    "-vf",
    getVideoPosterFilter(variant),
    "-frames:v",
    "1",
    "-an",
    derivativeAbsolutePath
  ]);

  return buildDescriptor({ variant, derivativeRelativePath, derivativeAbsolutePath });
}

async function writeVideoPlaybackDerivative({
  sourceAbsolutePath,
  derivedRoot,
  mediaId,
  relativePath,
  commandRunner,
  profile
}) {
  const outputFormat = (profile?.outputFormat || "webm").toLowerCase();
  const derivativeRelativePath = buildDerivativeRelativePath(relativePath, mediaId, "playback", outputFormat);
  const derivativeAbsolutePath = resolveAbsolutePath(derivedRoot, derivativeRelativePath);
  await fs.mkdir(path.dirname(derivativeAbsolutePath), { recursive: true });

  const { args, normalizedProfile } = buildPlaybackFfmpegArgs({
    sourceAbsolutePath,
    derivativeAbsolutePath,
    profile
  });

  await commandRunner("ffmpeg", args);

  return buildDescriptor({
    variant: "playback",
    derivativeRelativePath,
    derivativeAbsolutePath,
    outputFormat: normalizedProfile.outputFormat
  });
}

async function generateImageDerivatives({ originalsRoot, derivedRoot, mediaId, relativePath }) {
  const derivatives = [];
  for (const variant of ["thumb", "small"]) {
    derivatives.push(
      await writeDerivative({
        originalsRoot,
        derivedRoot,
        mediaId,
        relativePath,
        variant
      })
    );
  }

  return derivatives;
}

async function generateVideoDerivatives({
  sourceAbsolutePath,
  derivedRoot,
  mediaId,
  relativePath,
  commandRunner,
  playbackProfile
}) {
  const derivatives = [];

  for (const variant of ["thumb", "small"]) {
    derivatives.push(
      await writeVideoPosterDerivative({
        sourceAbsolutePath,
        derivedRoot,
        mediaId,
        relativePath,
        variant,
        commandRunner
      })
    );
  }

  derivatives.push(
    await writeVideoPlaybackDerivative({
      sourceAbsolutePath,
      derivedRoot,
      mediaId,
      relativePath,
      commandRunner,
      profile: playbackProfile
    })
  );

  return derivatives;
}

async function generateDerivativesForMedia({
  originalsRoot,
  derivedRoot,
  mediaId,
  relativePath,
  playbackProfile,
  commandRunner = execFileAsync
}) {
  const sourceAbsolutePath = resolveAbsolutePath(originalsRoot, relativePath);
  const inputType = await detectInputType({ sourceAbsolutePath, relativePath, commandRunner });

  if (inputType === "image") {
    return generateImageDerivatives({ originalsRoot, derivedRoot, mediaId, relativePath });
  }

  return generateVideoDerivatives({
    sourceAbsolutePath,
    derivedRoot,
    mediaId,
    relativePath,
    commandRunner,
    playbackProfile
  });
}

module.exports = {
  generateDerivativesForMedia
};
