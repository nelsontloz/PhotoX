export const SCRFD_INPUT_SIZE = 640

export interface ScrfdTensorLike {
  dims: readonly number[]
  data: Float32Array | number[]
}

export interface ScrfdDetection {
  box: { x: number; y: number; w: number; h: number }
  score: number
  kps: [number, number][]
}

export interface ScrfdRgb {
  data: Uint8Array
  width: number
  height: number
  channels: number
}

export interface ScrfdCoordinateMap {
  scaleX: number
  scaleY: number
  offsetX: number
  offsetY: number
}

const SCRFD_STRIDES = [8, 16, 32] as const
// SCRFD heads emit 2 predictions per grid cell, both anchored at the same center
const NUM_ANCHORS = 2

function anchorsForStride(stride: number): number {
  return (SCRFD_INPUT_SIZE / stride) ** 2 * NUM_ANCHORS
}

// ponytail: canonical SCRFD layout (insightface/model_zoo/scrfd.py) — output row i belongs to
// cell floor(i / 2) (row-major, both anchors share one center) and centers sit at cell * stride
// with no half-pixel offset
export function scrfdPreprocess(rgb: ScrfdRgb): Float32Array {
  const { data, width, height, channels } = rgb
  if (channels !== 3) {
    throw new Error(`SCRFD preprocessing expects 3-channel RGB, got ${channels} channels`)
  }
  if (width <= 0 || height <= 0) {
    throw new Error(`SCRFD preprocessing expects positive dimensions, got ${width}x${height}`)
  }
  const pixels = width * height
  if (data.length !== pixels * 3) {
    throw new Error(`SCRFD preprocessing expected ${pixels * 3} bytes, got ${data.length}`)
  }
  const chw = new Float32Array(pixels * 3)
  for (let i = 0; i < pixels; i++) {
    chw[i] = (data[i * 3]! - 127.5) / 128
    chw[pixels + i] = (data[i * 3 + 1]! - 127.5) / 128
    chw[2 * pixels + i] = (data[i * 3 + 2]! - 127.5) / 128
  }
  return chw
}

interface IouBox {
  x: number
  y: number
  w: number
  h: number
}

function iou(a: IouBox, b: IouBox): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.w * a.h + b.w * b.h - inter
  return union <= 0 ? 0 : inter / union
}

// ponytail: greedy class-agnostic NMS (SCRFD is single-class) — O(n^2) is fine for one image
function nms(detections: ScrfdDetection[], threshold: number): ScrfdDetection[] {
  const sorted = [...detections].sort((a, b) => b.score - a.score)
  const kept: ScrfdDetection[] = []
  for (const det of sorted) {
    if (kept.every((k) => iou(k.box, det.box) <= threshold)) kept.push(det)
  }
  return kept
}

export function decodeScrfdOutputs(
  outputs: ScrfdTensorLike[],
  map: ScrfdCoordinateMap,
  opts: { scoreThreshold?: number; nmsThreshold?: number } = {},
): ScrfdDetection[] {
  const scoreThreshold = opts.scoreThreshold ?? 0.5
  const nmsThreshold = opts.nmsThreshold ?? 0.4

  if (outputs.length !== SCRFD_STRIDES.length * 3) {
    throw new Error(`SCRFD expects 9 outputs (3 strides x score/bbox/kps), got ${outputs.length}`)
  }

  const strideByAnchors = new Map<number, number>(
    SCRFD_STRIDES.map((stride) => [anchorsForStride(stride), stride]),
  )
  interface StrideOutputs {
    score?: ScrfdTensorLike
    bbox?: ScrfdTensorLike
    kps?: ScrfdTensorLike
  }
  const grouped = new Map<number, StrideOutputs>()
  for (const tensor of outputs) {
    // det_10g.onnx exports flat [anchors, C]; some exports keep the batch dim as [1, anchors, C]
    let anchors: number
    let last: number
    if (tensor.dims.length === 3 && tensor.dims[0] === 1) {
      anchors = tensor.dims[1]!
      last = tensor.dims[2]!
    } else if (tensor.dims.length === 2) {
      anchors = tensor.dims[0]!
      last = tensor.dims[1]!
    } else {
      throw new Error(`Unexpected SCRFD tensor dims [${tensor.dims.join(', ')}]`)
    }
    if (!strideByAnchors.has(anchors)) {
      throw new Error(`Unknown SCRFD anchor count ${anchors} (expected 12800, 3200 or 800)`)
    }
    if (tensor.data.length !== anchors * last) {
      throw new Error(
        `SCRFD tensor [${tensor.dims.join(', ')}] has ${tensor.data.length} values, ` +
          `expected ${anchors * last}`,
      )
    }
    const entry = grouped.get(anchors) ?? {}
    if (last === 1) entry.score = tensor
    else if (last === 4) entry.bbox = tensor
    else if (last === 10) entry.kps = tensor
    else throw new Error(`Unexpected SCRFD output width ${last} for ${anchors} anchors`)
    grouped.set(anchors, entry)
  }

  const detections: ScrfdDetection[] = []
  for (const stride of SCRFD_STRIDES) {
    const anchors = anchorsForStride(stride)
    const entry = grouped.get(anchors)
    if (!entry?.score || !entry.bbox || !entry.kps) {
      throw new Error(`Missing SCRFD score/bbox/kps tensor for stride ${stride}`)
    }
    const grid = SCRFD_INPUT_SIZE / stride
    for (let i = 0; i < anchors; i++) {
      const score = entry.score.data[i]!
      // ponytail: !(>=) also drops NaN scores (a plain `<` would admit them)
      if (!(score >= scoreThreshold)) continue
      const cell = Math.floor(i / NUM_ANCHORS)
      const cx = (cell % grid) * stride
      const cy = Math.floor(cell / grid) * stride
      const dl = entry.bbox.data[i * 4]! * stride
      const dt = entry.bbox.data[i * 4 + 1]! * stride
      const dr = entry.bbox.data[i * 4 + 2]! * stride
      const db = entry.bbox.data[i * 4 + 3]! * stride
      const x1 = (cx - dl) * map.scaleX + map.offsetX
      const y1 = (cy - dt) * map.scaleY + map.offsetY
      const x2 = (cx + dr) * map.scaleX + map.offsetX
      const y2 = (cy + db) * map.scaleY + map.offsetY
      const kps: [number, number][] = []
      for (let k = 0; k < 5; k++) {
        kps.push([
          (cx + entry.kps.data[i * 10 + k * 2]! * stride) * map.scaleX + map.offsetX,
          (cy + entry.kps.data[i * 10 + k * 2 + 1]! * stride) * map.scaleY + map.offsetY,
        ])
      }
      detections.push({ box: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, score, kps })
    }
  }

  return nms(detections, nmsThreshold)
}
