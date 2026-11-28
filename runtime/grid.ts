// The grid: where the actors are, to find the ones in a part of the world without looking
// at all of them.
//
// The world is cut into square cells of CELL pixels, and each actor is listed in every cell
// its box covers (its feet's cell when it has no box). Cells are kept by key in a map, so
// the grid has no bounds: it covers every map, wherever they are. An actor is listed again
// only when it leaves the cells it was in, which most moves never do.
//
// What a query finds comes in creation order, never in the grid's own order: the same game
// gives the same answers on every display.

/** A cell's side, in game pixels: a few tiles, about an actor's size or a bit more. */
export const CELL = 64

/** What the grid lists: an actor, by where it is and when it was created. */
export interface Listed {
  /** Creation order: what queries sort by. */
  readonly order: number
  /** The cells it is listed in, inclusive; null when it is not listed. */
  cells: { left: number; top: number; right: number; bottom: number } | null
}

/** A cell's key: its column and row, packed into one number (±2^20 cells each way). */
function key(cx: number, cy: number) {
  return (cx + 0x100000) * 0x200000 + (cy + 0x100000)
}

export class Grid<T extends Listed> {
  #cells = new Map<number, T[]>()
  /** Marks the items already found by the query under way: one that covers several cells is found once. */
  #seen = new WeakMap<T, number>()
  #query = 0

  /**
   * Lists an item over the rectangle (left, top) – (right, bottom), inclusive, in world
   * pixels, or takes it out with null. Does nothing when its cells are the same.
   */
  set(item: T, left: number, top: number, right: number, bottom: number): void
  set(item: T, area: null): void
  set(item: T, left: number | null, top = 0, right = 0, bottom = 0) {
    const was = item.cells
    if (left === null) {
      if (was) this.#each(was.left, was.top, was.right, was.bottom, (c, k) => this.#drop(c, k, item))
      item.cells = null
      return
    }
    const l = Math.floor(left / CELL)
    const t = Math.floor(top / CELL)
    const r = Math.floor(right / CELL)
    const b = Math.floor(bottom / CELL)
    if (was && was.left === l && was.top === t && was.right === r && was.bottom === b) return
    if (was) this.#each(was.left, was.top, was.right, was.bottom, (c, k) => this.#drop(c, k, item))
    for (let cx = l; cx <= r; cx++) {
      for (let cy = t; cy <= b; cy++) {
        const k = key(cx, cy)
        let c = this.#cells.get(k)
        if (!c) this.#cells.set(k, (c = []))
        c.push(item)
      }
    }
    item.cells = { left: l, top: t, right: r, bottom: b }
  }

  /**
   * The items listed in the cells the rectangle touches (inclusive, in world pixels), in
   * creation order: the ones that may be in it, for the caller to check exactly.
   */
  near(left: number, top: number, right: number, bottom: number): T[] {
    const out: T[] = []
    const q = ++this.#query
    const l = Math.floor(left / CELL)
    const t = Math.floor(top / CELL)
    const r = Math.floor(right / CELL)
    const b = Math.floor(bottom / CELL)
    for (let cx = l; cx <= r; cx++) {
      for (let cy = t; cy <= b; cy++) {
        const c = this.#cells.get(key(cx, cy))
        if (!c) continue
        for (const item of c) {
          if (this.#seen.get(item) === q) continue
          this.#seen.set(item, q)
          out.push(item)
        }
      }
    }
    if (out.length > 1) out.sort((a, b) => a.order - b.order)
    return out
  }

  /** Empties the grid. */
  clear() {
    this.#cells.clear()
  }

  #each(l: number, t: number, r: number, b: number, f: (c: T[], k: number) => void) {
    for (let cx = l; cx <= r; cx++) {
      for (let cy = t; cy <= b; cy++) {
        const k = key(cx, cy)
        const c = this.#cells.get(k)
        if (c) f(c, k)
      }
    }
  }

  #drop(c: T[], k: number, item: T) {
    const i = c.indexOf(item)
    if (i < 0) return
    // Order inside a cell does not matter (queries sort): swap with the last.
    c[i] = c[c.length - 1]
    c.pop()
    if (c.length === 0) this.#cells.delete(k)
  }
}
