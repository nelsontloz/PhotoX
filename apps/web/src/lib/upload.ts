import axios from 'axios'
import { useUploadStore } from '../store/upload-store'
import { useThumbStore } from '../store/thumb-store'
import { useAppStore } from '../store/app-store'
import { uploadFile } from '../api/assets'
import { makeThumbnail } from './clientThumbnail'

export const MAX_CONCURRENT = 3

const filesRef = new Map<string, File>()

export function enqueueFiles(files: File[], opts?: { onComplete?: () => void }): void {
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
    opts?.onComplete?.()
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
          const thumbUrl = URL.createObjectURL(thumbBlob)
          useThumbStore.getState().set(id, thumbUrl)
          useUploadStore.getState().setStatus(id, 'uploading', { localThumbUrl: thumbUrl })
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
