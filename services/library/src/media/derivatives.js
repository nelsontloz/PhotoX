const fs = require("node:fs/promises");
const path = require("node:path");

const sharp = require("sharp");

const { buildDerivativeRelativePath, resolveAbsolutePath } = require("./paths");

const pendingDerivatives = new Map();

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_err) {
    return false;
  }
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

async function ensureWebpDerivative({ originalsRoot, derivedRoot, mediaRow, variant }) {
  const sourceAbsolutePath = resolveAbsolutePath(originalsRoot, mediaRow.relative_path);
  const derivativeRelativePath = buildDerivativeRelativePath(mediaRow.relative_path, mediaRow.id, variant);
  const derivativeAbsolutePath = resolveAbsolutePath(derivedRoot, derivativeRelativePath);

  if (pendingDerivatives.has(derivativeAbsolutePath)) {
    return pendingDerivatives.get(derivativeAbsolutePath);
  }

  const promise = (async () => {
    try {
      if (await fileExists(derivativeAbsolutePath)) {
        return {
          relativePath: derivativeRelativePath,
          absolutePath: derivativeAbsolutePath,
          contentType: "image/webp"
        };
      }

      await fs.mkdir(path.dirname(derivativeAbsolutePath), { recursive: true });

      const pipeline = variantTransform(sharp(sourceAbsolutePath).rotate(), variant);
      await pipeline.webp({ quality: 82 }).toFile(derivativeAbsolutePath);

      return {
        relativePath: derivativeRelativePath,
        absolutePath: derivativeAbsolutePath,
        contentType: "image/webp"
      };
    } finally {
      pendingDerivatives.delete(derivativeAbsolutePath);
    }
  })();

  pendingDerivatives.set(derivativeAbsolutePath, promise);
  return promise;
}

module.exports = {
  ensureWebpDerivative
};
