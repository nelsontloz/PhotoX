import { describe, it, expect, beforeEach } from 'vitest'
import { serialize, deserialize } from './uploadPersistence'
import type { UploadItem } from '../store/upload-store'

function makeItem(overrides: Partial<UploadItem> = {}): UploadItem {
  return {
    id: 'u1',
    fileName: 'photo.jpg',
    sizeBytes: 1024,
    kind: 'photo',
    progress: 50,
    status: 'uploading',
    ...overrides,
  }
}

describe('uploadPersistence', () => {
  const store: Record<string, string> = {}

  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k])
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v
        },
        removeItem: (k: string) => {
          delete store[k]
        },
        clear: () => {
          Object.keys(store).forEach((k) => delete store[k])
        },
      },
      writable: true,
      configurable: true,
    })
  })

  describe('serialize', () => {
    it('strips localThumbUrl', () => {
      const item = makeItem({ localThumbUrl: 'blob:http://localhost/thumb' })
      const result = serialize([item])
      expect(result[0]).not.toHaveProperty('localThumbUrl')
    })

    it('converts uploading items to error with reload message', () => {
      const item = makeItem({ status: 'uploading', progress: 75 })
      const result = serialize([item])
      const first = result[0]!
      expect(first.status).toBe('error')
      expect(first.error).toBe('Interrupted by reload — please retry')
      expect(first.progress).toBe(0)
    })

    it('converts queued items to error with reload message', () => {
      const item = makeItem({ status: 'queued', progress: 0 })
      const result = serialize([item])
      const first = result[0]!
      expect(first.status).toBe('error')
      expect(first.error).toBe('Interrupted by reload — please retry')
    })

    it('leaves done and error items unchanged in status', () => {
      const doneItem = makeItem({ status: 'done', progress: 100, assetId: 'a1', fileId: 'f1' })
      const errorItem = makeItem({
        status: 'error',
        progress: 30,
        error: 'Upload failed',
      })
      const result = serialize([doneItem, errorItem])
      const first = result[0]!
      const second = result[1]!
      expect(first.status).toBe('done')
      expect(first.assetId).toBe('a1')
      expect(first.fileId).toBe('f1')
      expect(second.status).toBe('error')
      expect(second.error).toBe('Upload failed')
    })
  })

  describe('deserialize', () => {
    it('returns items from valid v1 payload', () => {
      const payload = {
        v: 1,
        items: [
          {
            id: 'u1',
            fileName: 'photo.jpg',
            sizeBytes: 2048,
            kind: 'photo',
            progress: 100,
            status: 'done',
            assetId: 'a1',
          },
        ],
      }
      const result = deserialize(payload)
      expect(result).toHaveLength(1)
      const first = result[0]!
      expect(first.id).toBe('u1')
      expect(first.status).toBe('done')
      expect(first.assetId).toBe('a1')
    })

    it('returns [] and clears storage on null', () => {
      localStorage.setItem('photox.upload-queue.v1', 'bad')
      const result = deserialize(null)
      expect(result).toEqual([])
      expect(localStorage.getItem('photox.upload-queue.v1')).toBeNull()
    })

    it('returns [] and clears storage on version mismatch', () => {
      localStorage.setItem('photox.upload-queue.v1', 'bad')
      const result = deserialize({ v: 2, items: [] })
      expect(result).toEqual([])
      expect(localStorage.getItem('photox.upload-queue.v1')).toBeNull()
    })

    it('returns [] and clears storage on undefined', () => {
      localStorage.setItem('photox.upload-queue.v1', 'bad')
      const result = deserialize(undefined)
      expect(result).toEqual([])
      expect(localStorage.getItem('photox.upload-queue.v1')).toBeNull()
    })

    it('skips items with unknown status values', () => {
      const payload = {
        v: 1,
        items: [
          {
            id: 'u1',
            fileName: 'a.jpg',
            sizeBytes: 100,
            kind: 'photo',
            progress: 0,
            status: 'done',
          },
          {
            id: 'u2',
            fileName: 'b.jpg',
            sizeBytes: 200,
            kind: 'photo',
            progress: 0,
            status: 'unknown',
          },
        ],
      }
      const result = deserialize(payload)
      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('u1')
    })

    it('skips items with invalid kind', () => {
      const payload = {
        v: 1,
        items: [
          {
            id: 'u1',
            fileName: 'a.jpg',
            sizeBytes: 100,
            kind: 'invalid',
            progress: 0,
            status: 'done',
          },
        ],
      }
      const result = deserialize(payload)
      expect(result).toEqual([])
    })

    it('coerces types defensively', () => {
      const payload = {
        v: 1,
        items: [
          {
            id: 123,
            fileName: 456,
            sizeBytes: '789',
            kind: 'photo',
            progress: '50',
            status: 'done',
          },
        ],
      }
      const result = deserialize(payload)
      expect(result).toHaveLength(1)
      const first = result[0]!
      expect(first.id).toBe('123')
      expect(first.fileName).toBe('456')
      expect(first.sizeBytes).toBe(789)
      expect(first.progress).toBe(50)
    })
  })
})
