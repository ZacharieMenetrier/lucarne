// What the Actors page edits: actors/<name>.json, the values set in the editor for every
// actor of that kind, next to actors/<name>.ts, its code. The code declares each variable
// with its default; the file holds only the values set here, by name (see
// runtime/values.ts). The box is one of them, set by drawing it.
//
//   {
//     "box": { "x": -5, "y": -6, "width": 10, "height": 6 },
//     "speed": 0.5
//   }
//
// A value left out is the one inherited: from the parent actor's file, or the code. No DOM
// here: the page draws it.

import type { Box } from '../../runtime/collision'
import type { Value } from '../../runtime/values'

export const ACTORS_DIR = 'actors'

/** A pixel, relative to the actor's feet. */
export interface Cell {
  x: number
  y: number
}

/** What a file sets, by variable name. Read as it is: checked against the code at play. */
export type Values = Record<string, unknown>

/** Reads an actor file: its values by name. */
export function parseActorFile(text: string): Values {
  const raw = JSON.parse(text) as unknown
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('an actor file holds an object: its values by name')
  return raw as Values
}

/** An actor file, one value per line, the box first and then by name, for small diffs. */
export function serializeActorFile(values: Values): string {
  const names = Object.keys(values).sort((a, b) => (a === 'box' ? -1 : b === 'box' ? 1 : a.localeCompare(b)))
  if (!names.length) return '{}\n'
  return `{\n${names.map((n) => `  ${JSON.stringify(n)}: ${inlineJson(values[n])}`).join(',\n')}\n}\n`
}

/** A value on one line, spaced like the rest of the game's files: `["a", "b"]`, `{ "x": 1 }`. */
export function inlineJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inlineJson).join(', ')}]`
  if (v && typeof v === 'object') {
    const parts = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inlineJson(x)}`)
    return parts.length ? `{ ${parts.join(', ')} }` : '{}'
  }
  return JSON.stringify(v)
}

/** The box a drag draws, from the pixel pressed to the pixel under the pointer, both in. */
export function boxFromDrag(a: Cell, b: Cell): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 }
}

/** What a pointer holds of a box: an edge or a corner to resize it, or its inside to move it. */
export type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/**
 * The part of the box at a point (in game pixels, fractional, from the feet), or null: away
 * from it. `reach` is how far from an edge still holds it, in game pixels: the page makes it
 * a few screen pixels, so that a small box still has an inside to move it by.
 */
export function boxHandle(box: Box, p: { x: number; y: number }, reach: number): Handle | null {
  const l = box.x, r = box.x + box.width, t = box.y, b = box.y + box.height
  if (p.x < l - reach || p.x > r + reach || p.y < t - reach || p.y > b + reach) return null
  // The nearer edge wins on a box thinner than twice the reach.
  const ns = Math.abs(p.y - t) <= reach && Math.abs(p.y - t) <= Math.abs(p.y - b) ? 'n' : Math.abs(p.y - b) <= reach ? 's' : ''
  const we = Math.abs(p.x - l) <= reach && Math.abs(p.x - l) <= Math.abs(p.x - r) ? 'w' : Math.abs(p.x - r) <= reach ? 'e' : ''
  if (ns || we) return (ns + we) as Handle
  return p.x > l && p.x < r && p.y > t && p.y < b ? 'move' : null
}

/** A box moved, or resized by a handle, by whole pixels. It keeps at least one pixel each way. */
export function dragBox(box: Box, handle: Handle, dx: number, dy: number): Box {
  dx = Math.round(dx)
  dy = Math.round(dy)
  if (handle === 'move') return { ...box, x: box.x + dx, y: box.y + dy }
  let l = box.x, r = box.x + box.width, t = box.y, b = box.y + box.height
  if (handle.includes('w')) l = Math.min(l + dx, r - 1)
  if (handle.includes('e')) r = Math.max(r + dx, l + 1)
  if (handle.includes('n')) t = Math.min(t + dy, b - 1)
  if (handle.includes('s')) b = Math.max(b + dy, t + 1)
  return { x: l, y: t, width: r - l, height: b - t }
}

/** A box with one of its numbers typed: whole pixels, its size at least one. */
export function setBoxField(box: Box, field: keyof Box, n: number): Box {
  n = Math.round(n)
  return { ...box, [field]: field === 'width' || field === 'height' ? Math.max(1, n) : n }
}

/**
 * The box an actor gets back when "none" is unticked: the one it inherits (undefined, to
 * clear its own), or, when it inherits none too, one around its picture (8 × 8 above its
 * feet when it draws nothing).
 */
export function boxWhenOn(inherited: Box | null, picture: { x: number; y: number; w: number; h: number } | null): Box | undefined {
  if (inherited) return undefined
  return picture ? { x: picture.x, y: picture.y, width: picture.w, height: picture.h } : { x: -4, y: -8, width: 8, height: 8 }
}

/** Where a value comes from: the code's default, or the file (or map) that set it last. */
export interface Resolved {
  value: unknown
  /** null: the code's default. Otherwise what set it: an actor's name, or "here" for the layer asked about. */
  from: string | null
}

/**
 * A value as the game will see it: the code's default, then each layer that sets it, the
 * last winning (see runtime/values.ts). `layers` go from the farthest (the oldest parent's
 * file) to the nearest (the placed actor).
 */
export function resolve(name: string, codeDefault: Value, layers: readonly { from: string; values: Values }[]): Resolved {
  let out: Resolved = { value: codeDefault, from: null }
  for (const l of layers) if (name in l.values) out = { value: l.values[name], from: l.from }
  return out
}

/** An actor's file layers, the farthest parent first and its own last (see `resolve`). */
export function fileLayers(actor: { name: string; parents: readonly string[] }, files: ActorFiles): { from: string; values: Values }[] {
  return [...actor.parents].reverse().concat(actor.name).map((name) => ({ from: name, values: files.values(name) }))
}

/** The names a layer sets that the code does not declare (renamed, removed): to remove. */
export function staleNames(values: Values, variables: readonly { name: string }[]): string[] {
  return Object.keys(values).filter((n) => !variables.some((v) => v.name === n)).sort()
}

/** Are two values the same (a value set to what it already is changes nothing)? */
export function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** One undoable change: a value set or cleared in one actor file. */
interface Step {
  actor: string
  name: string
  /** undefined: not set. */
  value: unknown
}

/** Every actor file of the game, with undo. */
export class ActorFiles {
  private past: Step[] = []
  private future: Step[] = []
  /** Called after every change, with the actor changed: to save, and to redraw. */
  onEdit: (actor: string) => void = () => {}

  constructor(readonly files = new Map<string, Values>()) {}

  /** The values an actor's file sets (none: an empty object). */
  values(actor: string): Values {
    return this.files.get(actor) ?? {}
  }

  /** Sets a value in an actor's file, or clears it (undefined): it is inherited again. */
  set(actor: string, name: string, value: unknown) {
    const before = this.values(actor)[name]
    if (before === undefined ? value === undefined : value !== undefined && sameValue(before, value)) return
    this.past.push({ actor, name, value: before })
    this.future = []
    this.apply(actor, name, value)
  }

  undo() {
    this.step(this.past, this.future)
  }

  redo() {
    this.step(this.future, this.past)
  }

  private step(from: Step[], to: Step[]) {
    const s = from.pop()
    if (!s) return
    to.push({ actor: s.actor, name: s.name, value: this.values(s.actor)[s.name] })
    this.apply(s.actor, s.name, s.value)
  }

  private apply(actor: string, name: string, value: unknown) {
    const values = { ...this.values(actor) }
    if (value === undefined) delete values[name]
    else values[name] = structuredClone(value)
    if (Object.keys(values).length) this.files.set(actor, values)
    else this.files.delete(actor)
    this.onEdit(actor)
  }
}
