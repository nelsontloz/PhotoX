import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Repository } from 'typeorm'
import { envFaceDetectorKind } from '@photox/shared-config'
import { AppSetting } from '../database/entities/app-setting.entity'
import { Face } from '../database/entities/face.entity'
import {
  DETECTIONS_REPROCESS_LAST_RUN_KEY,
  EMBEDDING_REPROCESS_LAST_RUN_KEY,
  FACE_DETECTOR_SETTING_KEY,
  FACE_REPROCESS_LAST_RUN_KEY,
  METADATA_REPROCESS_LAST_RUN_KEY,
  OCR_REPROCESS_LAST_RUN_KEY,
  PLACES_BACKFILL_LAST_RUN_KEY,
  SettingsService,
} from './settings.service'

const NO_FACES = { human: 0, scrfd: 0, unset: 0 }

function makeService(
  row?: Partial<AppSetting>,
  faces: { human: number; scrfd: number; unset: number } = NO_FACES,
) {
  const findOne = vi.fn().mockResolvedValue(row ?? null)
  const upsert = vi.fn().mockResolvedValue({})
  const repo = { findOne, upsert } as unknown as Repository<AppSetting>
  const count = vi.fn((opts: { where: { detector?: unknown } }) => {
    if (opts.where.detector === 'human') return Promise.resolve(faces.human)
    if (opts.where.detector === 'scrfd') return Promise.resolve(faces.scrfd)
    return Promise.resolve(faces.unset)
  })
  const faceRepo = { count } as unknown as Repository<Face>
  return { service: new SettingsService(repo, faceRepo), findOne, upsert, count }
}

function envDefault(): 'human' | 'scrfd' {
  return process.env.FACE_DETECTOR === 'scrfd' ? 'scrfd' : 'human'
}

describe('SettingsService', () => {
  const prevKind = process.env.FACE_DETECTOR
  const prevPath = process.env.FACE_DETECTOR_MODEL_PATH
  const prevStorageDir = process.env.STORAGE_DIR

  afterEach(() => {
    if (prevKind === undefined) delete process.env.FACE_DETECTOR
    else process.env.FACE_DETECTOR = prevKind
    if (prevPath === undefined) delete process.env.FACE_DETECTOR_MODEL_PATH
    else process.env.FACE_DETECTOR_MODEL_PATH = prevPath
    if (prevStorageDir === undefined) delete process.env.STORAGE_DIR
    else process.env.STORAGE_DIR = prevStorageDir
  })

  it('defaults to human when FACE_DETECTOR is unset and no row exists', async () => {
    delete process.env.FACE_DETECTOR
    const { service, findOne } = makeService()
    expect(envFaceDetectorKind()).toBe('human')
    expect(await service.getFaceDetector()).toBe('human')
    expect(findOne).toHaveBeenCalledWith({ where: { key: FACE_DETECTOR_SETTING_KEY } })
  })

  it('honours FACE_DETECTOR=scrfd as the env default', async () => {
    process.env.FACE_DETECTOR = 'scrfd'
    const { service } = makeService()
    expect(envFaceDetectorKind()).toBe('scrfd')
    expect(await service.getFaceDetector()).toBe('scrfd')
  })

  it('treats an unknown FACE_DETECTOR value as human', () => {
    process.env.FACE_DETECTOR = 'bogus'
    expect(envFaceDetectorKind()).toBe('human')
  })

  it('returns the stored detector over the env default', async () => {
    process.env.FACE_DETECTOR = 'human'
    const { service } = makeService({
      key: FACE_DETECTOR_SETTING_KEY,
      value: 'scrfd',
      updatedAt: new Date(),
    })
    expect(await service.getFaceDetector()).toBe('scrfd')
  })

  it('falls back to the env default for an invalid stored value', async () => {
    process.env.FACE_DETECTOR = 'scrfd'
    const { service } = makeService({
      key: FACE_DETECTOR_SETTING_KEY,
      value: 'bogus',
      updatedAt: new Date(),
    })
    expect(await service.getFaceDetector()).toBe('scrfd')
  })

  it('falls back to the env default for a non-string stored value', async () => {
    delete process.env.FACE_DETECTOR
    const { service } = makeService({
      key: FACE_DETECTOR_SETTING_KEY,
      value: 42,
      updatedAt: new Date(),
    })
    expect(await service.getFaceDetector()).toBe('human')
  })

  it('upserts the detector on the face.detector key', async () => {
    const { service, upsert } = makeService()
    await service.setFaceDetector('scrfd')
    expect(upsert).toHaveBeenCalledWith({ key: FACE_DETECTOR_SETTING_KEY, value: 'scrfd' }, ['key'])
  })

  it('reports settings with scrfd unavailable when the model file is missing', async () => {
    delete process.env.FACE_DETECTOR_MODEL_PATH
    const dir = await mkdtemp(join(tmpdir(), 'photox-settings-'))
    process.env.STORAGE_DIR = dir
    try {
      const { service } = makeService({
        key: FACE_DETECTOR_SETTING_KEY,
        value: 'scrfd',
        updatedAt: new Date(),
      })
      expect(await service.getSettings()).toEqual({
        detector: 'scrfd',
        envDefault: envDefault(),
        models: { scrfd: false },
        facesByDetector: NO_FACES,
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports settings with scrfd available when the model file exists', async () => {
    delete process.env.FACE_DETECTOR_MODEL_PATH
    const dir = await mkdtemp(join(tmpdir(), 'photox-settings-'))
    process.env.STORAGE_DIR = dir
    try {
      await mkdir(join(dir, 'models'), { recursive: true })
      await writeFile(join(dir, 'models', 'det_10g.onnx'), Buffer.from('model'))
      const { service } = makeService()
      expect(await service.getSettings()).toEqual({
        detector: envDefault(),
        envDefault: envDefault(),
        models: { scrfd: true },
        facesByDetector: NO_FACES,
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('honours FACE_DETECTOR_MODEL_PATH when reporting availability', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'photox-settings-'))
    process.env.FACE_DETECTOR_MODEL_PATH = join(dir, 'custom.onnx')
    try {
      const { service } = makeService()
      expect((await service.getSettings()).models).toEqual({ scrfd: false })
      await writeFile(process.env.FACE_DETECTOR_MODEL_PATH, Buffer.from('model'))
      expect((await service.getSettings()).models).toEqual({ scrfd: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('counts faces by detector provenance, null as unset', async () => {
    const { service } = makeService(undefined, { human: 2, scrfd: 5, unset: 3 })
    expect((await service.getSettings()).facesByDetector).toEqual({ human: 2, scrfd: 5, unset: 3 })
  })

  it('persists the last reprocess run and reads it back', async () => {
    const run = {
      startedAt: '2026-10-01T00:00:00.000Z',
      total: 12,
      enqueued: 12,
      detector: 'scrfd' as const,
    }
    const { service, upsert } = makeService({ key: FACE_REPROCESS_LAST_RUN_KEY, value: run })
    await service.setLastRun('face', run)
    expect(upsert).toHaveBeenCalledWith({ key: FACE_REPROCESS_LAST_RUN_KEY, value: run }, ['key'])
    expect(await service.getLastRun('face')).toEqual(run)
  })

  it('returns null for a malformed last reprocess run', async () => {
    const { service } = makeService({
      key: FACE_REPROCESS_LAST_RUN_KEY,
      value: { startedAt: 'nope', total: 'x' },
    })
    expect(await service.getLastRun('face')).toBeNull()
  })

  it('persists the last embedding reprocess run and reads it back', async () => {
    const run = {
      startedAt: '2026-10-03T00:00:00.000Z',
      total: 5,
      enqueued: 4,
      model: 'siglip2-b16-224',
    }
    const { service, upsert } = makeService({ key: EMBEDDING_REPROCESS_LAST_RUN_KEY, value: run })
    await service.setLastRun('embedding', run)
    expect(upsert).toHaveBeenCalledWith({ key: EMBEDDING_REPROCESS_LAST_RUN_KEY, value: run }, [
      'key',
    ])
    expect(await service.getLastRun('embedding')).toEqual(run)
  })

  it('returns null for a malformed embedding last reprocess run', async () => {
    const { service } = makeService({
      key: EMBEDDING_REPROCESS_LAST_RUN_KEY,
      value: { startedAt: 1, model: 42 },
    })
    expect(await service.getLastRun('embedding')).toBeNull()
  })

  it('persists the last OCR reprocess run and reads it back', async () => {
    const run = { startedAt: '2026-10-03T00:00:00.000Z', total: 7, enqueued: 7 }
    const { service, upsert } = makeService({ key: OCR_REPROCESS_LAST_RUN_KEY, value: run })
    await service.setLastRun('ocr', run)
    expect(upsert).toHaveBeenCalledWith({ key: OCR_REPROCESS_LAST_RUN_KEY, value: run }, ['key'])
    expect(await service.getLastRun('ocr')).toEqual(run)
  })

  it('returns null for a malformed OCR last reprocess run', async () => {
    const { service } = makeService({
      key: OCR_REPROCESS_LAST_RUN_KEY,
      value: { startedAt: '2026-10-03T00:00:00.000Z', total: 'x' },
    })
    expect(await service.getLastRun('ocr')).toBeNull()
  })

  it('persists the last detections reprocess run and reads it back', async () => {
    const run = { startedAt: '2026-10-03T00:00:00.000Z', total: 9, enqueued: 9 }
    const { service, upsert } = makeService({ key: DETECTIONS_REPROCESS_LAST_RUN_KEY, value: run })
    await service.setLastRun('detections', run)
    expect(upsert).toHaveBeenCalledWith({ key: DETECTIONS_REPROCESS_LAST_RUN_KEY, value: run }, [
      'key',
    ])
    expect(await service.getLastRun('detections')).toEqual(run)
  })

  it('returns null for a malformed detections last reprocess run', async () => {
    const { service } = makeService({
      key: DETECTIONS_REPROCESS_LAST_RUN_KEY,
      value: { startedAt: 1, enqueued: 'x' },
    })
    expect(await service.getLastRun('detections')).toBeNull()
  })

  it('persists the last metadata reprocess run and reads it back', async () => {
    const run = { startedAt: '2026-10-04T00:00:00.000Z', total: 11, enqueued: 10 }
    const { service, upsert } = makeService({ key: METADATA_REPROCESS_LAST_RUN_KEY, value: run })
    await service.setLastRun('metadata', run)
    expect(upsert).toHaveBeenCalledWith({ key: METADATA_REPROCESS_LAST_RUN_KEY, value: run }, [
      'key',
    ])
    expect(await service.getLastRun('metadata')).toEqual(run)
  })

  it('returns null for a malformed metadata last reprocess run', async () => {
    const { service } = makeService({
      key: METADATA_REPROCESS_LAST_RUN_KEY,
      value: { startedAt: '2026-10-04T00:00:00.000Z', total: 11 },
    })
    expect(await service.getLastRun('metadata')).toBeNull()
  })

  it('persists the last places backfill run and reads it back', async () => {
    const run = { startedAt: '2026-10-05T00:00:00.000Z', total: 20, updated: 3 }
    const { service, upsert } = makeService({ key: PLACES_BACKFILL_LAST_RUN_KEY, value: run })
    await service.setLastRun('places', run)
    expect(upsert).toHaveBeenCalledWith({ key: PLACES_BACKFILL_LAST_RUN_KEY, value: run }, ['key'])
    expect(await service.getLastRun('places')).toEqual(run)
  })

  it('returns null for a malformed places backfill run', async () => {
    const { service } = makeService({
      key: PLACES_BACKFILL_LAST_RUN_KEY,
      value: { startedAt: '2026-10-05T00:00:00.000Z', updated: 'x' },
    })
    expect(await service.getLastRun('places')).toBeNull()
  })

  it('returns null for a non-object stored run', async () => {
    const { service } = makeService({ key: FACE_REPROCESS_LAST_RUN_KEY, value: 'corrupt' })
    expect(await service.getLastRun('face')).toBeNull()
  })
})
