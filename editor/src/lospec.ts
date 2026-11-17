// Importing a palette from Lospec (https://lospec.com/palette-list).
// One palette per request, only when the user asks for it: the public JSON
// of a palette page, https://lospec.com/palette-list/<slug>.json.

import { parsePalette } from './project'

export interface LospecPalette {
  name: string
  author: string
  colors: string[]
}

/** Palette slug from a Lospec link ("https://lospec.com/palette-list/sweetie-16") or the slug itself. */
export function lospecSlug(input: string): string | null {
  let text = input.trim()
  if (!text) return null
  if (/^https?:\/\//i.test(text) || /^(www\.)?lospec\.com\//i.test(text)) {
    let url: URL
    try {
      url = new URL(/^https?:/i.test(text) ? text : `https://${text}`)
    } catch {
      return null
    }
    if (!/^(www\.)?lospec\.com$/i.test(url.hostname)) return null
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] !== 'palette-list' || !parts[1]) return null
    text = parts[1]
  }
  text = text.replace(/\.(json|hex|gpl|txt|png)$/i, '').toLowerCase()
  return /^[a-z0-9][a-z0-9-]*$/.test(text) ? text : null
}

export async function fetchLospecPalette(slug: string): Promise<LospecPalette> {
  const res = await fetch(`https://lospec.com/palette-list/${slug}.json`, { cache: 'no-store' })
  if (res.status === 404) throw new Error('No palette with this name on Lospec.')
  if (!res.ok) throw new Error(`Lospec answered ${res.status}.`)
  const text = await res.text()
  const raw = JSON.parse(text) as { name?: unknown; author?: unknown }
  // Without duplicates, in the palette's own order.
  const colors = [...new Set(parsePalette(text))]
  if (!colors.length) throw new Error('This palette has no colors.')
  return {
    name: typeof raw.name === 'string' ? raw.name : slug,
    author: typeof raw.author === 'string' ? raw.author : '',
    colors,
  }
}
