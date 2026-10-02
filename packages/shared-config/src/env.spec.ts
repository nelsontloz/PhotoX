import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'path'
import {
  FACE_DETECTOR_MODEL_FILE,
  envFaceDetectorKind,
  loadEnv,
  resolveFaceDetectorModelPath,
} from './env'

describe('AUTH_REFRESH_TTL parsing', () => {
  const original = process.env.AUTH_REFRESH_TTL
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_REFRESH_TTL
    else process.env.AUTH_REFRESH_TTL = original
  })

  it('parses duration units to milliseconds', () => {
    process.env.AUTH_REFRESH_TTL = '2h'
    expect(loadEnv().AUTH_REFRESH_TTL).toBe(2 * 60 * 60 * 1000)
  })

  it('defaults to 1d when unset', () => {
    delete process.env.AUTH_REFRESH_TTL
    expect(loadEnv().AUTH_REFRESH_TTL).toBe(1 * 24 * 60 * 60 * 1000)
  })

  it('falls back to 15 minutes for an unparseable value', () => {
    process.env.AUTH_REFRESH_TTL = 'garbage'
    expect(loadEnv().AUTH_REFRESH_TTL).toBe(15 * 60 * 1000)
  })
})

describe('face detector helpers', () => {
  const originalKind = process.env.FACE_DETECTOR
  const originalPath = process.env.FACE_DETECTOR_MODEL_PATH
  const originalStorageDir = process.env.STORAGE_DIR

  afterEach(() => {
    if (originalKind === undefined) delete process.env.FACE_DETECTOR
    else process.env.FACE_DETECTOR = originalKind
    if (originalPath === undefined) delete process.env.FACE_DETECTOR_MODEL_PATH
    else process.env.FACE_DETECTOR_MODEL_PATH = originalPath
    if (originalStorageDir === undefined) delete process.env.STORAGE_DIR
    else process.env.STORAGE_DIR = originalStorageDir
  })

  it('envFaceDetectorKind only honours scrfd', () => {
    delete process.env.FACE_DETECTOR
    expect(envFaceDetectorKind()).toBe('human')
    process.env.FACE_DETECTOR = 'scrfd'
    expect(envFaceDetectorKind()).toBe('scrfd')
    process.env.FACE_DETECTOR = 'bogus'
    expect(envFaceDetectorKind()).toBe('human')
  })

  it('resolveFaceDetectorModelPath prefers FACE_DETECTOR_MODEL_PATH', () => {
    process.env.FACE_DETECTOR_MODEL_PATH = '/custom/det.onnx'
    expect(resolveFaceDetectorModelPath()).toBe('/custom/det.onnx')
  })

  it('resolveFaceDetectorModelPath defaults under STORAGE_DIR/models', () => {
    delete process.env.FACE_DETECTOR_MODEL_PATH
    process.env.STORAGE_DIR = '/tmp/photox-storage-test'
    expect(resolveFaceDetectorModelPath()).toBe(
      join('/tmp/photox-storage-test', 'models', FACE_DETECTOR_MODEL_FILE),
    )
  })
})
