/** Unlimited undo/redo for the length of the session. */
export class History<T> {
  private undos: T[] = []
  private redos: T[] = []

  push(change: T) {
    this.undos.push(change)
    this.redos = []
  }

  undo(): T | null {
    const c = this.undos.pop()
    if (!c) return null
    this.redos.push(c)
    return c
  }

  redo(): T | null {
    const c = this.redos.pop()
    if (!c) return null
    this.undos.push(c)
    return c
  }

  /** Rewrites every change; returning null drops it (renamed or deleted sprite). */
  rewrite(fn: (change: T) => T | null) {
    const map = (list: T[]) => list.map(fn).filter((c): c is T => c !== null)
    this.undos = map(this.undos)
    this.redos = map(this.redos)
  }

  get canUndo() {
    return this.undos.length > 0
  }

  get canRedo() {
    return this.redos.length > 0
  }
}
