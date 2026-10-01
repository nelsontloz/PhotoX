export interface DetectedBox {
  box: { x: number; y: number; w: number; h: number }
  score: number
  // 5 points in input-buffer pixel coords, order: leftEye, rightEye, nose, mouthLeft, mouthRight
  points5: [number, number][]
}

export interface FaceDetectionBackend {
  load(): Promise<void>
  detect(buffer: Buffer): Promise<DetectedBox[]>
}
