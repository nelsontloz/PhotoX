import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Repository } from 'typeorm'
import { AppSetting } from '../database/entities/app-setting.entity'
import { SettingsService } from './settings.service'

const FACE_REPROCESS_LAST_RUN_KEY = 'face.reprocess.lastRun'
const EMBEDDING_REPROCESS_LAST_RUN_KEY = 'embedding.reprocess.lastRun'
const OCR_REPROCESS_LAST_RUN_KEY = 'ocr.reprocess.lastRun'
const DETECTIONS_REPROCESS_LAST_RUN_KEY = 'detections.reprocess.lastRun'
const PLACES_BACKFILL_LAST_RUN_KEY = 'places.backfill.lastRun'
const METADATA_REPROCESS_LAST_RUN_KEY = 'metadata.reprocess.lastRun'

function makeService(row?: Partial<AppSetting>) {
  const findOne = vi.fn().mockResolvedValue(row ?? null)
  const upsert = vi.fn().mockResolvedValue({})
  const repo = { findOne, upsert } as unknown as Repository<AppSetting>
  return { service: new SettingsService(repo), findOne, upsert }
}

describe('SettingsService', () => {
  const prevPath = process.env.FACE_DETECTOR_MODEL_PATH
  const prevStorageDir = process.env.STORAGE_DIR

  afterEach(() => {
    if (prevPath === undefined) delete process.env.FACE_DETECTOR_MODEL_PATH
    else process.env.FACE_DETECTOR_MODEL_PATH = prevPath
    if (prevStorageDir === undefined) delete process.env.STORAGE_DIR
    else process.env.STORAGE_DIR = prevStorageDir
  })

  it('reports the model unavailable when the model file is missing', async () => {
    delete process.env.FACE_DETECTOR_MODEL_PATH
    const dir = await mkdtemp(join(tmpdir(), 'photox-settings-'))
    process.env.STORAGE_DIR = dir
    try {
      const { service } = makeService()
      expect(await service.getSettings()).toEqual({ modelAvailable: false })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports the model available when the model file exists', async () => {
    delete process.env.FACE_DETECTOR_MODEL_PATH
    const dir = await mkdtemp(join(tmpdir(), 'photox-settings-'))
    process.env.STORAGE_DIR = dir
    try {
      await mkdir(join(dir, 'models'), { recursive: true })
      await writeFile(join(dir, 'models', 'det_10g.onnx'), Buffer.from('model'))
      const { service } = makeService()
      expect(await service.getSettings()).toEqual({ modelAvailable: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('honours FACE_DETECTOR_MODEL_PATH when reporting availability', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'photox-settings-'))
    process.env.FACE_DETECTOR_MODEL_PATH = join(dir, 'custom.onnx')
    try {
      const { service } = makeService()
      expect(await service.getSettings()).toEqual({ modelAvailable: false })
      await writeFile(process.env.FACE_DETECTOR_MODEL_PATH, Buffer.from('model'))
      expect(await service.getSettings()).toEqual({ modelAvailable: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('persists the last face reprocess run and reads it back', async () => {
    const run = { startedAt: '2026-10-01T00:00:00.000Z', total: 12, enqueued: 12 }
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
