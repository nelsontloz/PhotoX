const fs = require("node:fs/promises");
const path = require("node:path");

const sharp = require("sharp");

const { buildDerivativeRelativePath, resolveAbsolutePath } = require("./paths");

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

  return {
    variant,
    relativePath: derivativeRelativePath,
    absolutePath: derivativeAbsolutePath
  };
}

async function generateDerivativesForMedia({ originalsRoot, derivedRoot, mediaId, relativePath }) {
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

module.exports = {
  generateDerivativesForMedia
};
