// What the font import needs from a font file, read from the file itself rather than
// measured by the browser (browsers measure a little differently, and the size of a pixel
// font is found from these numbers): the size of its em, its line, which characters it
// has and the box of each one's ink.
//
// Reads TrueType outlines (.ttf, and .otf or .woff holding them). For other files
// (.woff2, PostScript outlines) it returns null, and the import measures with the browser.

/** A character's ink, in font units (y up from the baseline). */
export interface InkBox {
  xMin: number
  yMin: number
  xMax: number
  yMax: number
}

export interface FontFileInfo {
  unitsPerEm: number
  /** The line, in font units: above the baseline, and below it (positive). */
  ascent: number
  descent: number
  /** The characters asked for that the font has, with their ink (null: drawn blank). */
  glyphs: Map<string, InkBox | null>
}

/** Reads a font file's numbers for these characters, or null if it is not TrueType. */
export async function readFontFile(bytes: ArrayBuffer, characters: string): Promise<FontFileInfo | null> {
  try {
    const tables = await readTables(bytes)
    const { head, hhea, maxp, loca, glyf, cmap } = tables
    if (!head || !hhea || !maxp || !loca || !glyf || !cmap) return null
    const unitsPerEm = head.getUint16(18)
    const longOffsets = head.getInt16(50) === 1
    const numGlyphs = maxp.getUint16(4)
    const offset = (i: number) => (longOffsets ? loca.getUint32(i * 4) : loca.getUint16(i * 2) * 2)
    const glyphOf = charMap(cmap)
    const glyphs = new Map<string, InkBox | null>()
    for (const ch of characters) {
      const id = glyphOf(ch.codePointAt(0)!)
      if (!id || id >= numGlyphs) continue
      const at = offset(id)
      const empty = offset(id + 1) === at
      glyphs.set(ch, empty ? null : { xMin: glyf.getInt16(at + 2), yMin: glyf.getInt16(at + 4), xMax: glyf.getInt16(at + 6), yMax: glyf.getInt16(at + 8) })
    }
    return { unitsPerEm, ascent: hhea.getInt16(4), descent: -hhea.getInt16(6), glyphs }
  } catch {
    return null
  }
}

/** The tables of a .ttf/.otf or a .woff (whose tables may be compressed), by tag. */
async function readTables(bytes: ArrayBuffer): Promise<Record<string, DataView>> {
  const view = new DataView(bytes)
  const tables: Record<string, DataView> = {}
  const tag = (at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))
  if (tag(0) === 'wOFF') {
    const count = view.getUint16(12)
    for (let i = 0; i < count; i++) {
      const at = 44 + i * 20
      const offset = view.getUint32(at + 4)
      const length = view.getUint32(at + 8)
      const original = view.getUint32(at + 12)
      const data = bytes.slice(offset, offset + length)
      tables[tag(at).trim()] = new DataView(length < original ? await inflate(data) : data)
    }
    return tables
  }
  const count = view.getUint16(4)
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16
    tables[tag(at).trim()] = new DataView(bytes, view.getUint32(at + 8), view.getUint32(at + 12))
  }
  return tables
}

async function inflate(data: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Response(stream).arrayBuffer()
}

/** The glyph of a character, from the cmap table (Unicode, format 12 or 4); 0 for none. */
function charMap(cmap: DataView): (code: number) => number {
  const count = cmap.getUint16(2)
  let best: { format: number; at: number } | null = null
  for (let i = 0; i < count; i++) {
    const platform = cmap.getUint16(4 + i * 8)
    const encoding = cmap.getUint16(6 + i * 8)
    const at = cmap.getUint32(8 + i * 8)
    const format = cmap.getUint16(at)
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))
    if (!unicode || (format !== 4 && format !== 12)) continue
    if (!best || format === 12) best = { format, at }
  }
  if (!best) return () => 0
  const { format, at } = best
  if (format === 12) {
    const groups = cmap.getUint32(at + 12)
    return (code) => {
      for (let g = 0; g < groups; g++) {
        const p = at + 16 + g * 12
        const start = cmap.getUint32(p)
        if (code >= start && code <= cmap.getUint32(p + 4)) return cmap.getUint32(p + 8) + code - start
      }
      return 0
    }
  }
  const segments = cmap.getUint16(at + 6) / 2
  const ends = at + 14
  const starts = ends + segments * 2 + 2
  const deltas = starts + segments * 2
  const ranges = deltas + segments * 2
  return (code) => {
    for (let s = 0; s < segments; s++) {
      if (code > cmap.getUint16(ends + s * 2)) continue
      const start = cmap.getUint16(starts + s * 2)
      if (code < start) return 0
      const delta = cmap.getInt16(deltas + s * 2)
      const range = cmap.getUint16(ranges + s * 2)
      if (range === 0) return (code + delta) & 0xffff
      const g = cmap.getUint16(ranges + s * 2 + range + (code - start) * 2)
      return g === 0 ? 0 : (g + delta) & 0xffff
    }
    return 0
  }
}
