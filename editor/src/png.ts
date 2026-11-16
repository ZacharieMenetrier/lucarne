import { Bitmap } from './bitmap'
import { normalize } from './color'

export async function decodePng(bytes: Uint8Array): Promise<Bitmap> {
  const blob = new Blob([bytes as BlobPart], { type: 'image/png' })
  const image = await createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  })
  const canvas = new OffscreenCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(image, 0, 0)
  image.close()
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = new Uint32Array(pixels.data.buffer)
  for (let i = 0; i < data.length; i++) data[i] = normalize(data[i])
  return new Bitmap(canvas.width, canvas.height, data)
}

export async function encodePng(bmp: Bitmap): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(toImageData(bmp), 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

export function toImageData(bmp: Bitmap): ImageData {
  return new ImageData(new Uint8ClampedArray(bmp.data.slice().buffer), bmp.width, bmp.height)
}
