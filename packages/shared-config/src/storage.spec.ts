import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { LocalStorageService } from './storage'

describe('LocalStorageService.pathFor', () => {
  const storage = new LocalStorageService()
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'photox-storage-'))
    process.env.STORAGE_DIR = root
  })

  it('resolves normal nested storage keys under the root', () => {
    expect(storage.pathFor('originals/user-1/file.jpg')).toBe(
      join(root, 'originals/user-1/file.jpg'),
    )
  })

  it('rejects keys that escape the storage root', () => {
    const escaped = ['../../etc/passwd', '../originals/x.jpg', '/etc/passwd', '../storage-evil/x']
    for (const key of escaped) {
      expect(() => storage.pathFor(key)).toThrow('Invalid storage key')
    }
  })

  it('reports whether bytes exist at a key', async () => {
    expect(await storage.exists('originals/user-1/absent.jpg')).toBe(false)
    writeFileSync(join(root, 'present.jpg'), 'bytes')
    expect(await storage.exists('present.jpg')).toBe(true)
  })
})
