import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../api/assets')
vi.mock('./clientThumbnail')

import { enqueueFiles } from './upload'
import { useUploadStore } from '../store/upload-store'
import * as assetsApi from '../api/assets'
import * as clientThumbnail from './clientThumbnail'

const uploadFileMock = vi.mocked(assetsApi.uploadFile)
const makeThumbnailMock = vi.mocked(clientThumbnail.makeThumbnail)

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
    makeThumbnailMock.mockReset()
    makeThumbnailMock.mockResolvedValue(null)
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
})
