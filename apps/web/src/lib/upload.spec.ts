import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../api/assets')
vi.mock('./hash')

import { enqueueFiles } from './upload'
import { useUploadStore } from '../store/upload-store'
import * as assetsApi from '../api/assets'
import * as hashModule from './hash'

const uploadFileMock = vi.mocked(assetsApi.uploadFile)
const checkFilesExistMock = vi.mocked(assetsApi.checkFilesExist)
const hashFileMock = vi.mocked(hashModule.hashFile)

function makeFile(name: string): File {
  return new File([new Uint8Array(8)], name, { type: 'image/jpeg' })
}

class FakeAxiosError extends Error {
  isAxiosError = true
  response: { status: number; data: unknown }
  constructor(status: number, data: unknown) {
    super(`status ${status}`)
    this.response = { status, data }
  }
}

describe('enqueueFiles', () => {
  beforeEach(() => {
    uploadFileMock.mockReset()
    checkFilesExistMock.mockReset()
    hashFileMock.mockReset()
    // default: hashing unavailable (fail-open miss) — uploads proceed as before
    hashFileMock.mockResolvedValue(null)
    useUploadStore.setState({ items: [], dismissed: false })
  })

  it('continues processing remaining items when earlier ones return 409', async () => {
    for (let i = 0; i < 3; i++) {
      uploadFileMock.mockImplementationOnce(() => {
        throw new FakeAxiosError(409, {
          existingAssetId: `asset-existing-${i}`,
          existingFileId: `file-existing-${i}`,
        })
      })
    }
    uploadFileMock
      .mockImplementationOnce(() => Promise.resolve({ id: 'asset-d', fileId: 'file-d' } as never))
      .mockImplementationOnce(() => Promise.resolve({ id: 'asset-e', fileId: 'file-e' } as never))

    const files = [
      makeFile('a.jpg'),
      makeFile('b.jpg'),
      makeFile('c.jpg'),
      makeFile('d.jpg'),
      makeFile('e.jpg'),
    ]
    enqueueFiles(files)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const items = useUploadStore.getState().items
    expect(items).toHaveLength(5)
    expect(items.every((i) => i.status === 'done')).toBe(true)
    expect(uploadFileMock).toHaveBeenCalledTimes(5)
  })

  it('skips the upload lane on existence hits with ONE check call', async () => {
    hashFileMock.mockImplementation((file) => Promise.resolve(`checksum-${file.name}`))
    checkFilesExistMock.mockImplementation((items) =>
      Promise.resolve(
        items.map((item) => ({
          checksumSha256: item.checksumSha256,
          exists: true,
          existingFileId: `file-for-${item.checksumSha256}`,
          existingAssetId: `asset-for-${item.checksumSha256}`,
        })),
      ),
    )

    enqueueFiles([makeFile('hit-a.jpg'), makeFile('hit-b.jpg')])

    await vi.waitFor(() => {
      const items = useUploadStore.getState().items
      expect(items).toHaveLength(2)
      expect(items.every((i) => i.status === 'done')).toBe(true)
    })

    expect(checkFilesExistMock).toHaveBeenCalledTimes(1)
    const sentItems = checkFilesExistMock.mock.calls[0]?.[0]
    expect(sentItems?.map((i) => i.checksumSha256).sort()).toEqual([
      'checksum-hit-a.jpg',
      'checksum-hit-b.jpg',
    ])
    expect(sentItems?.every((i) => typeof i.sizeBytes === 'number')).toBe(true)
    expect(uploadFileMock).not.toHaveBeenCalled()
    const items = useUploadStore.getState().items
    expect(items.map((i) => i.assetId).sort()).toEqual([
      'asset-for-checksum-hit-a.jpg',
      'asset-for-checksum-hit-b.jpg',
    ])
    expect(items.map((i) => i.fileId).sort()).toEqual([
      'file-for-checksum-hit-a.jpg',
      'file-for-checksum-hit-b.jpg',
    ])
  })

  it('uploads misses reported by the existence check', async () => {
    hashFileMock.mockImplementation((file) => Promise.resolve(`checksum-${file.name}`))
    checkFilesExistMock.mockResolvedValue([{ checksumSha256: 'checksum-miss.jpg', exists: false }])
    uploadFileMock.mockResolvedValue({ id: 'asset-new', fileId: 'file-new' } as never)

    enqueueFiles([makeFile('miss.jpg')])

    await vi.waitFor(() => {
      expect(useUploadStore.getState().items[0]?.status).toBe('done')
    })

    expect(checkFilesExistMock).toHaveBeenCalledTimes(1)
    expect(uploadFileMock).toHaveBeenCalledTimes(1)
    expect(useUploadStore.getState().items[0]).toMatchObject({
      status: 'done',
      fileId: 'file-new',
      assetId: 'asset-new',
    })
  })

  it('uploads everything when the existence check fails', async () => {
    hashFileMock.mockResolvedValue('checksum-x')
    checkFilesExistMock.mockRejectedValue(new Error('exists endpoint down'))
    uploadFileMock
      .mockResolvedValueOnce({ id: 'asset-1', fileId: 'file-1' } as never)
      .mockResolvedValueOnce({ id: 'asset-2', fileId: 'file-2' } as never)

    enqueueFiles([makeFile('a.jpg'), makeFile('b.jpg')])

    await vi.waitFor(() => {
      const items = useUploadStore.getState().items
      expect(items).toHaveLength(2)
      expect(items.every((i) => i.status === 'done')).toBe(true)
    })

    expect(uploadFileMock).toHaveBeenCalledTimes(2)
  })

  it('uploads everything when hashing rejects (fail-open)', async () => {
    hashFileMock.mockRejectedValue(new Error('worker boom'))
    uploadFileMock.mockResolvedValue({ id: 'asset-1', fileId: 'file-1' } as never)

    enqueueFiles([makeFile('a.jpg')])

    await vi.waitFor(() => {
      expect(useUploadStore.getState().items[0]?.status).toBe('done')
    })

    expect(checkFilesExistMock).not.toHaveBeenCalled()
    expect(uploadFileMock).toHaveBeenCalledTimes(1)
    expect(useUploadStore.getState().items[0]).toMatchObject({
      status: 'done',
      fileId: 'file-1',
      assetId: 'asset-1',
    })
  })

  it('pre-rejects files larger than 4GB without hashing or uploading', async () => {
    const big = makeFile('big.mp4')
    Object.defineProperty(big, 'size', { value: 4 * 1024 * 1024 * 1024 + 1 })

    enqueueFiles([big])

    await vi.waitFor(() => {
      expect(useUploadStore.getState().items[0]?.status).toBe('error')
    })

    expect(hashFileMock).not.toHaveBeenCalled()
    expect(checkFilesExistMock).not.toHaveBeenCalled()
    expect(uploadFileMock).not.toHaveBeenCalled()
  })
})
