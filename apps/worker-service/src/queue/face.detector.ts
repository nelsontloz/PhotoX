import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import sharp from 'sharp';
import { resolveFaceDetectorModelPath } from '@photox/shared-config';
import { SCRFD_INPUT_SIZE, decodeScrfdOutputs } from './scrfd.decode';
import { toNchw } from './nchw';
import { lazyOnce, loadNamedSession } from './model-loader';
import { FaceEmbedderService, alignFaceCrop, type RawImage } from './face.embedder';

export interface DetectedBox {
  box: { x: number; y: number; w: number; h: number };
  score: number;
  // 5 points in input-buffer pixel coords, order: leftEye, rightEye, nose, mouthLeft, mouthRight
  points5: [number, number][];
}

interface DetectedFace {
  box: { x: number; y: number; w: number; h: number };
  confidence: number;
  embedding: number[];
}

// Minimum face box side, in resized-input pixels: smaller crops are mush at the embedder's 112px
// and would waste an ONNX embed.
export const FACE_MIN_SIZE_PX = 40;

// ponytail: SCRFD-10G is the only detector. The model path stays a direct FACE_DETECTOR_MODEL_PATH
// env read (WORKER_SERVICE_PORT precedent) resolved lazily at load time: .env is loaded in
// app.module's body, after this module is evaluated. InsightFace det_10g detector weights (~17MB)
// are for non-commercial research use — provision with
// `pnpm --filter @photox/worker-service face-model` (never committed) or point
// FACE_DETECTOR_MODEL_PATH at your own copy.
@Injectable()
export class FaceDetectorService implements OnModuleInit {
  private readonly logger = new Logger(FaceDetectorService.name);
  private readonly session = lazyOnce(async () => {
    const modelPath = resolveFaceDetectorModelPath();
    const named = await loadNamedSession(
      modelPath,
      `Face detector model not found at ${modelPath} — run ` +
        `'pnpm --filter @photox/worker-service face-model' or set FACE_DETECTOR_MODEL_PATH`,
    );
    this.logger.log(`SCRFD face detector loaded: ${modelPath}`);
    return named;
  });

  constructor(private readonly embedder: FaceEmbedderService) {}

  async onModuleInit() {
    try {
      await this.session();
      this.logger.log('Face detector ready: scrfd');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // ponytail: missing weights must not kill the worker at bootstrap — jobs fail per-asset
      // with the same provisioning error until the model is fetched
      this.logger.warn(
        `Face detector unavailable; detection will fail per-job until provisioned: ${message}`,
      );
    }
  }

  async detect(buffer: Buffer): Promise<DetectedFace[]> {
    const boxes = await this.detectBoxes(buffer);
    if (boxes.length === 0) return [];
    // ponytail: decode once, warp each face in-memory — avoids a sharp pipeline per face
    const raw = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    const src: RawImage = {
      data: raw.data,
      width: raw.info.width,
      height: raw.info.height,
      channels: raw.info.channels,
    };
    const faces: DetectedFace[] = [];
    for (const { box, score, points5 } of boxes) {
      // check before alignment/embedding on purpose — skipping here saves the ONNX call
      if (Math.max(box.w, box.h) < FACE_MIN_SIZE_PX) continue;
      const aligned = alignFaceCrop(src, points5);
      const embedding = await this.embedder.embed(aligned);
      faces.push({ box, confidence: Number(score.toFixed(4)), embedding });
    }
    return faces;
  }

  private async detectBoxes(buffer: Buffer): Promise<DetectedBox[]> {
    const { session, inputName } = await this.session();

    // ponytail: upstream scrfd.py letterboxes (aspect-preserving resize + black pad, top-left),
    // not a squash; upscaling small images matches upstream too
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) throw new Error('Could not read image dimensions');
    const scale = Math.min(SCRFD_INPUT_SIZE / meta.width, SCRFD_INPUT_SIZE / meta.height);
    const newW = Math.round(meta.width * scale);
    const newH = Math.round(meta.height * scale);
    // resize + extend in one pipeline (same shape as detect.service): the pad is top-left, and
    // 'fill' makes the resized dims exact, so the decoder scale-back is meta/newW and meta/newH
    const letterboxed = await sharp(buffer)
      .removeAlpha()
      .toColourspace('srgb')
      .resize(newW, newH, { fit: 'fill' })
      .extend({
        right: SCRFD_INPUT_SIZE - newW,
        bottom: SCRFD_INPUT_SIZE - newH,
        background: { r: 0, g: 0, b: 0 },
      })
      .raw()
      .toBuffer();

    const { Tensor } = await import('onnxruntime-node');
    const tensor = new Tensor(
      'float32',
      // InsightFace normalization: (x - 127.5) / 128 into CHW float32
      toNchw(letterboxed, SCRFD_INPUT_SIZE, SCRFD_INPUT_SIZE, 127.5, 128),
      [1, 3, SCRFD_INPUT_SIZE, SCRFD_INPUT_SIZE],
    );

    const outputs = await session.run({ [inputName]: tensor });
    const tensors = session.outputNames.map((name) => {
      const output = outputs[name]!;
      return { dims: output.dims, data: output.data as Float32Array };
    });

    // pad is top-left, so source coords are a pure scale back from the resized dims
    return decodeScrfdOutputs(tensors, {
      scaleX: meta.width / newW,
      scaleY: meta.height / newH,
    }).map((det) => ({
      box: det.box,
      score: det.score,
      points5: det.kps,
    }));
  }
}
