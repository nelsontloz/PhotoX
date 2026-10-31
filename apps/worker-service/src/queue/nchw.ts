// HWC uint8 RGB -> NCHW float32, normalized as (x - mean) / scale — one copy of the conversion
// every model input uses (SCRFD/ArcFace: 127.5/128, YOLO: 0/255)
export function toNchw(
  data: Uint8Array,
  width: number,
  height: number,
  mean: number,
  scale: number,
): Float32Array {
  const pixels = width * height;
  if (data.length !== pixels * 3) {
    throw new Error(`Expected ${pixels * 3} RGB bytes for ${width}x${height}, got ${data.length}`);
  }
  const chw = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    chw[i] = (data[i * 3]! - mean) / scale;
    chw[pixels + i] = (data[i * 3 + 1]! - mean) / scale;
    chw[2 * pixels + i] = (data[i * 3 + 2]! - mean) / scale;
  }
  return chw;
}
