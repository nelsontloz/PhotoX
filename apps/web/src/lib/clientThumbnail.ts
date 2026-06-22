export async function makeThumbnail(file: File, maxSide = 256): Promise<Blob | null> {
  if (!file.type.startsWith('image/')) return null

  try {
    const img = await loadImage(file)
    const canvas = document.createElement('canvas')
    const scale = Math.min(maxSide / img.naturalWidth, maxSide / img.naturalHeight, 1)
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)

    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.8),
    )
    URL.revokeObjectURL(img.src)
    return blob
  } catch {
    return null
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}
