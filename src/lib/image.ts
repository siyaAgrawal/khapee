/**
 * Reads a picked file and downsizes it in the browser before upload, so photos
 * stay small and never leave this machine on their way to any third party.
 */
export async function fileToDataUrl(file: File, maxSide = 1000, quality = 0.78): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.')
  if (file.size > 20 * 1024 * 1024) throw new Error('That image is too large (20 MB max).')

  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('That image could not be read.'))
    reader.readAsDataURL(file)
  })

  // GIFs would lose their animation through a canvas, so pass them through as-is.
  if (file.type === 'image/gif') return original

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('That image could not be read.'))
    img.src = original
  })

  const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return original
  ctx.drawImage(image, 0, 0, width, height)

  const encoded = canvas.toDataURL('image/jpeg', quality)
  // Keep whichever is smaller — tiny PNG logos can beat a re-encoded JPEG.
  return encoded.length < original.length ? encoded : original
}
