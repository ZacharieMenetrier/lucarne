import type { Bitmap } from './bitmap'

interface Entry {
  before: Bitmap
  after: Bitmap
}

/** Unlimited undo for one image, for the length of the session. */
export class History {
  private undos: Entry[] = []
  private redos: Entry[] = []

  /** Records a change. Ignored if the image did not change. */
  push(before: Bitmap, after: Bitmap) {
    if (before.equals(after)) return
    this.undos.push({ before: before.clone(), after: after.clone() })
    this.redos = []
  }

  undo(): Bitmap | null {
    const e = this.undos.pop()
    if (!e) return null
    this.redos.push(e)
    return e.before.clone()
  }

  redo(): Bitmap | null {
    const e = this.redos.pop()
    if (!e) return null
    this.undos.push(e)
    return e.after.clone()
  }

  get canUndo() {
    return this.undos.length > 0
  }

  get canRedo() {
    return this.redos.length > 0
  }
}
