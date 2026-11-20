// What the Actors page edits: each class of actors' box, saved in actors.json by the name
// the class is exported under (the name maps place it by). The game's code writes none.
//
//   {
//     "version": 1,
//     "actors": {
//       "Hero": { "box": { "x": -5, "y": -6, "width": 10, "height": 6 } }
//     }
//   }
//
// A box is a rectangle in game pixels, (x, y) its top left relative to the actor's feet
// (its position, where its sprite's origin is drawn). No DOM here: the page draws it.

import type { Box } from '../../runtime/collision'

export const ACTORS_FILE = 'actors.json'

/** A pixel, relative to the actor's feet. */
export interface Cell {
  x: number
  y: number
}

/** The boxes in actors.json, by class name. A class left out has no box. */
export function parseActors(text: string): Map<string, Box> {
  const raw = JSON.parse(text) as { actors?: Record<string, { box?: unknown }> }
  const out = new Map<string, Box>()
  for (const [name, entry] of Object.entries(raw?.actors ?? {})) {
    const b = entry?.box as Partial<Box> | undefined
    if (!b) continue
    const box = { x: b.x, y: b.y, width: b.width, height: b.height }
    // Whole pixels, and at least one: anything else was not drawn here.
    if (!Object.values(box).every(Number.isInteger) || box.width! < 1 || box.height! < 1) continue
    out.set(name, box as Box)
  }
  return out
}

/** actors.json, one line per class, sorted by name so that diffs stay small. */
export function serializeActors(boxes: ReadonlyMap<string, Box>): string {
  const names = [...boxes.keys()].sort()
  const lines = names.map((n) => {
    const { x, y, width, height } = boxes.get(n)!
    return `    ${JSON.stringify(n)}: { "box": { "x": ${x}, "y": ${y}, "width": ${width}, "height": ${height} } }`
  })
  return `{\n  "version": 1,\n  "actors": {${lines.length ? `\n${lines.join(',\n')}\n  ` : ''}}\n}\n`
}

/** The box a drag draws, from the pixel pressed to the pixel under the pointer, both in. */
export function boxFromDrag(a: Cell, b: Cell): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 }
}

function sameBox(a: Box | undefined, b: Box | null) {
  return a ? !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height : !b
}

/** The boxes of a game's actors, with undo. */
export class ActorBoxes {
  private past: { name: string; box: Box | null }[] = []
  private future: { name: string; box: Box | null }[] = []
  /** Called after every change, with the class changed: to save, and to redraw. */
  onEdit: (name: string) => void = () => {}

  constructor(readonly boxes = new Map<string, Box>()) {}

  get(name: string): Box | null {
    return this.boxes.get(name) ?? null
  }

  /** Gives a class its box, or takes it away (null). */
  set(name: string, box: Box | null) {
    if (sameBox(this.boxes.get(name), box)) return
    this.past.push({ name, box: this.get(name) })
    this.future = []
    this.apply(name, box)
  }

  undo() {
    const step = this.past.pop()
    if (!step) return
    this.future.push({ name: step.name, box: this.get(step.name) })
    this.apply(step.name, step.box)
  }

  redo() {
    const step = this.future.pop()
    if (!step) return
    this.past.push({ name: step.name, box: this.get(step.name) })
    this.apply(step.name, step.box)
  }

  private apply(name: string, box: Box | null) {
    if (box) this.boxes.set(name, { ...box })
    else this.boxes.delete(name)
    this.onEdit(name)
  }
}
