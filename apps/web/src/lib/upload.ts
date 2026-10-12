import axios from 'axios'
import { useUploadStore } from '../store/upload-store'
import { useAppStore } from '../store/app-store'
import { uploadFile } from '../api/assets'

const MAX_CONCURRENT = 3

const filesRef = new Map<string, File>()

export function enqueueFiles(files: File[]): void {
  if (files.length === 0) return

  const { enqueue } = useUploadStore.getState()
  enqueue(files)

  const enqueuedIds = useUploadStore
    .getState()
    .items.slice(-files.length)
    .map((i) => i.id)

  enqueuedIds.forEach((id, i) => {
    filesRef.set(id, files[i]!)
  })

  void processQueue(enqueuedIds).then(() => {
    useAppStore.getState().bumpTimelineRefresh()
  })
}

async function processQueue(ids: string[]): Promise<void> {
  let idx = 0

  async function worker() {
    while (idx < ids.length) {
      const currentIdx = idx++
      const id = ids[currentIdx]!
      const item = useUploadStore.getState().items.find((i) => i.id === id)
      if (item?.status !== 'queued') continue

      const file = filesRef.get(id)
      if (!file) continue

      useUploadStore.getState().setStatus(id, 'uploading')

      try {
        const thumbBlob = await makeThumbnail(file)
        if (thumbBlob) {
          useUploadStore
            .getState()
            .setStatus(id, 'uploading', { localThumbUrl: URL.createObjectURL(thumbBlob) })
        }

        const asset = await uploadFile(
          file,
          (pct) => useUploadStore.getState().setProgress(id, pct),
          item.kind,
        )
        useUploadStore.getState().setStatus(id, 'done', {
          fileId: asset.fileId,
          assetId: asset.id,
        })
        filesRef.delete(id)
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 409) {
          const { existingAssetId, existingFileId } = err.response.data as {
            existingAssetId: string
            existingFileId: string
          }
          useUploadStore.getState().setStatus(id, 'done', {
            fileId: existingFileId,
            assetId: existingAssetId,
          })
          filesRef.delete(id)
          continue
        }
        useUploadStore.getState().setStatus(id, 'error', {
          error: (err as Error).message ?? 'Upload failed',
        })
        filesRef.delete(id)
      }
    }
  }

  const workers = Array.from({ length: MAX_CONCURRENT }, () => worker())
  await Promise.allSettled(workers)
}

export async function makeThumbnail(file: File, maxSide = 256): Promise<Blob | null> {
  if (!file.type.startsWith('image/')) return null

  let bitmap: ImageBitmap
  try {
    // createImageBitmap decodes off the main thread and honors EXIF orientation by default
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }

  try {
    const canvas = document.createElement('canvas')
    const scale = Math.min(maxSide / bitmap.width, maxSide / bitmap.height, 1)
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)

    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8))
  } catch {
    return null
  } finally {
    bitmap.close()
  }
}
