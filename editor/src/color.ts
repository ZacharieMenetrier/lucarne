// A color is a 32-bit integer laid out like ImageData pixels read through a
// Uint32Array (little-endian): 0xAABBGGRR. 0 = transparent.

export type Color = number

export const TRANSPARENT: Color = 0

const HEX_RE = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i

export function isHex(text: string): boolean {
  return HEX_RE.test(text.trim())
}

export function hexToColor(hex: string): Color {
  const m = HEX_RE.exec(hex.trim())
  if (!m) throw new Error(`Invalid color: ${hex}`)
  const rgb = parseInt(m[1], 16)
  const r = (rgb >> 16) & 255
  const g = (rgb >> 8) & 255
  const b = rgb & 255
  const a = m[2] ? parseInt(m[2], 16) : 255
  return normalize(((a << 24) | (b << 16) | (g << 8) | r) >>> 0)
}

/** Every fully transparent pixel is 0. */
export function normalize(c: Color): Color {
  return c >>> 24 === 0 ? 0 : c >>> 0
}

function hex2(n: number) {
  return n.toString(16).padStart(2, '0')
}

export function colorToHex(c: Color): string {
  const r = c & 255
  const g = (c >>> 8) & 255
  const b = (c >>> 16) & 255
  const a = c >>> 24
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 255 ? hex2(a) : ''}`
}

export function colorToCss(c: Color): string {
  return `rgba(${c & 255}, ${(c >>> 8) & 255}, ${(c >>> 16) & 255}, ${(c >>> 24) / 255})`
}
