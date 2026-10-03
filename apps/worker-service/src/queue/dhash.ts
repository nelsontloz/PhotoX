export const DHASH_WIDTH = 9
export const DHASH_HEIGHT = 8

// ponytail: standard 9x8 dHash — compare each pixel with its right neighbor, row-major into 64
// bits, hex-encoded big-endian (16 lowercase chars). No deps: the caller hands us sharp's 9x8
// grayscale raw buffer (sharp already produces the oriented downscale).
export function computeDhash(
  grayscalePixels: ArrayLike<number>,
  width: number,
  height: number,
): string {
  if (width !== DHASH_WIDTH || height !== DHASH_HEIGHT) {
    throw new Error(
      `dHash expects a ${DHASH_WIDTH}x${DHASH_HEIGHT} grayscale buffer, got ${width}x${height}`,
    )
  }

  let bits = ''
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const left = grayscalePixels[y * width + x]!
      const right = grayscalePixels[y * width + x + 1]!
      bits += left > right ? '1' : '0'
    }
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0')
}
