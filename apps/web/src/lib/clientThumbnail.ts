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
