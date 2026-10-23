import axios from 'axios'
import { useUploadStore } from '../store/upload-store'
import { useAppStore } from '../store/app-store'
import { checkFilesExist, uploadFile } from '../api/assets'
import { hashFile } from './hash'

const MAX_CONCURRENT = 3

/** Files larger than this are rejected before hashing (core caps uploads at 4GB). */
const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024 * 1024

const filesRef = new Map<string, File>()
/** Whole-file checksums stay memory-only (never in the persisted store). */
const checksumsRef = new Map<string, string>()

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

  void runUploadFlow(enqueuedIds).then(() => {
    useAppStore.getState().bumpTimelineRefresh()
  })
}

function dropRefs(id: string): void {
  filesRef.delete(id)
  checksumsRef.delete(id)
}

async function runUploadFlow(ids: string[]): Promise<void> {
  // Phase 0: pre-reject oversize files without hashing.
  const hashableIds: string[] = []
  for (const id of ids) {
    const file = filesRef.get(id)
    if (!file) continue
    if (file.size > MAX_FILE_SIZE_BYTES) {
      useUploadStore.getState().setStatus(id, 'error', { error: 'File exceeds the 4GB limit' })
      dropRefs(id)
      continue
    }
    hashableIds.push(id)
  }
  if (hashableIds.length === 0) return

  // Phase 1: hash every file through the shared worker pool (fail-open miss on null).
  // hashFile is time-bounded and never rejects, but the outer catch keeps any unexpected
  // throw (store access, bookkeeping) from swallowing the upload lane below.
  const hashed: { id: string; checksumSha256: string }[] = []
  try {
    await Promise.all(
      hashableIds.map(async (id) => {
        const file = filesRef.get(id)
        const item = useUploadStore.getState().items.find((i) => i.id === id)
        if (!file || item?.status !== 'queued') return
        useUploadStore.getState().setStatus(id, 'hashing')
        let checksum: string | null
        try {
          checksum = await hashFile(file, (pct) => useUploadStore.getState().setProgress(id, pct))
        } catch {
          checksum = null
        }
        if (checksum) {
          checksumsRef.set(id, checksum)
          hashed.push({ id, checksumSha256: checksum })
        }
      }),
    )
  } catch {
    // Fall through: hashed items (if any) still get checked; the rest upload as misses.
  }

  // Phase 2: ONE existence check for the batch; hits skip the upload (and thumbnail) lane.
  if (hashed.length > 0) {
    try {
      const results = await checkFilesExist(
        hashed.map(({ checksumSha256 }) => ({ checksumSha256 })),
      )
      const byChecksum = new Map(results.map((result) => [result.checksumSha256, result]))
      for (const entry of hashed) {
        const match = byChecksum.get(entry.checksumSha256)
        if (match?.exists && match.existingFileId && match.existingAssetId) {
          useUploadStore.getState().setStatus(entry.id, 'done', {
            fileId: match.existingFileId,
            assetId: match.existingAssetId,
            progress: 100,
          })
          dropRefs(entry.id)
        }
      }
    } catch {
      // Existence-check failure falls through: every hashed item uploads below.
    }
  }

  // Phase 3: misses + check-failure fallback take the upload lane.
  const toUpload = hashableIds.filter((id) => {
    const item = useUploadStore.getState().items.find((i) => i.id === id)
    return item?.status === 'hashing' || item?.status === 'queued'
  })
  await processQueue(toUpload)
}

async function processQueue(ids: string[]): Promise<void> {
  let idx = 0

  async function worker() {
    while (idx < ids.length) {
      const currentIdx = idx++
      const id = ids[currentIdx]!
      const item = useUploadStore.getState().items.find((i) => i.id === id)
      if (item?.status !== 'queued' && item?.status !== 'hashing') continue

      const file = filesRef.get(id)
      if (!file) continue

      useUploadStore.getState().setStatus(id, 'uploading', { progress: 0 })

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
        dropRefs(id)
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
          dropRefs(id)
          continue
        }
        useUploadStore.getState().setStatus(id, 'error', {
          error: (err as Error).message ?? 'Upload failed',
        })
        dropRefs(id)
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
