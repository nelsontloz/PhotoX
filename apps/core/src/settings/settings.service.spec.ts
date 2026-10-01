import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Repository } from 'typeorm'
import { AppSetting } from '../database/entities/app-setting.entity'
import { FACE_DETECTOR_SETTING_KEY, SettingsService } from './settings.service'

function makeService(row?: Partial<AppSetting>) {
  const findOne = vi.fn().mockResolvedValue(row ?? null)
  const upsert = vi.fn().mockResolvedValue({})
  const repo = { findOne, upsert } as unknown as Repository<AppSetting>
  return { service: new SettingsService(repo), findOne, upsert }
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
    expect(service.envDefaultDetector()).toBe('human')
    expect(await service.getFaceDetector()).toBe('human')
    expect(findOne).toHaveBeenCalledWith({ where: { key: FACE_DETECTOR_SETTING_KEY } })
  })

  it('honours FACE_DETECTOR=scrfd as the env default', async () => {
    process.env.FACE_DETECTOR = 'scrfd'
    const { service } = makeService()
    expect(service.envDefaultDetector()).toBe('scrfd')
    expect(await service.getFaceDetector()).toBe('scrfd')
  })

  it('treats an unknown FACE_DETECTOR value as human', () => {
    process.env.FACE_DETECTOR = 'bogus'
    const { service } = makeService()
    expect(service.envDefaultDetector()).toBe('human')
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
})
