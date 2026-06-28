import { downloadFile, listThumbnails } from '../api/assets'

export async function loadAssetThumbBlob(
  id: string,
  preferSize: 'xl' | 'lg',
  signal?: AbortSignal,
): Promise<string | null> {
  const thumbs = await listThumbnails(id, signal)
  const picked = thumbs.find((t) => t.size === preferSize) ?? thumbs[0]
  if (!picked) return null
  const blob = await downloadFile(picked.fileId, signal)
  return URL.createObjectURL(blob)
}
