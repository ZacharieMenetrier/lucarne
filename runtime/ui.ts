// Ready-made UI: a dialogue box and a menu. Both are modal things: while one is open, the
// world stops behind it (see `Thing.modal`), and it removes itself when done.
//
//   new Dialogue(['Hello!', 'Nice weather today.'])
//   new Menu(['Yes', 'No'], (i) => { if (i === 0) shop.open() })
//
// They write in the game's font, in a box drawn with the game's sprite named "panel" (its
// middle row and column stretch, see `screen.panel`), or a plain box if it has none. The
// menu's cursor is the sprite named "cursor" if there is one. To change the text's color,
// extend them: `class Sign extends Dialogue { color = '#1a1c2c' }`.

import { font } from './fonts'
import { input } from './input'
import { screen } from './screen'
import { findSprite } from './sprites'
import { time } from './time'
import { Thing } from './world'

/** Space around a box and the screen's edge, in pixels. */
const MARGIN = 4
/** Space between a plain box's edge and its text. */
const PLAIN_PADDING = 4
/** Characters that appear per update (30 per second). */
const LETTERS_PER_UPDATE = 0.5

/** Draws a box: the "panel" sprite, or a plain one. Returns the padding inside it. */
function box(x: number, y: number, width: number, height: number, color: string) {
  const panel = findSprite('panel')
  if (panel) {
    screen.panel(panel, x, y, width, height)
    return { x: Math.floor(panel.width / 2) + 2, y: Math.floor(panel.height / 2) + 2 }
  }
  screen.rect(x, y, width, height, color)
  screen.rect(x + 1, y + 1, width - 2, height - 2, '#1a1c2c')
  return { x: PLAIN_PADDING, y: PLAIN_PADDING }
}

/** Padding inside a box, to size it before drawing it. */
function padding() {
  const panel = findSprite('panel')
  return panel ? { x: Math.floor(panel.width / 2) + 2, y: Math.floor(panel.height / 2) + 2 } : { x: PLAIN_PADDING, y: PLAIN_PADDING }
}

/**
 * A box at the bottom of the screen that shows text letter by letter, one page after the
 * other. The action button shows the whole page at once, then goes to the next one; after
 * the last, the dialogue closes.
 */
export class Dialogue extends Thing {
  modal = true
  /** Color of the text (and of a plain box's border). */
  color = '#f4f4f4'
  private readonly pages: string[]
  private page = 0
  private letters = 0

  constructor(pages: string | string[]) {
    super()
    this.pages = typeof pages === 'string' ? [pages] : pages
    if (this.pages.length === 0) this.remove()
  }

  /** Is the current page fully shown? */
  get done() {
    return this.letters >= [...this.pages[this.page]].length
  }

  update() {
    if (!this.done) this.letters += LETTERS_PER_UPDATE
    if (!input.pressed('action')) return
    if (!this.done) this.letters = Infinity
    else if (this.page < this.pages.length - 1) {
      this.page++
      this.letters = 0
    } else this.remove()
  }

  drawUI() {
    const f = font()
    const pad = padding()
    const width = screen.width - MARGIN * 2
    // Wrapped as a whole, so words don't jump to the next line as they appear.
    const lines = f.lines(this.pages[this.page], width - pad.x * 2)
    const height = lines.length * f.lineHeight + pad.y * 2
    const top = screen.height - MARGIN - height
    box(MARGIN, top, width, height, this.color)
    let left = Math.floor(this.letters)
    lines.forEach((line, i) => {
      const chars = [...line]
      if (left > 0) screen.text(chars.slice(0, left).join(''), MARGIN + pad.x, top + pad.y + i * f.lineHeight, this.color)
      left -= chars.length + 1
    })
    // A blinking mark: there is more to read, or the dialogue can be closed.
    if (this.done && Math.floor(time.uiMs / 400) % 2 === 0) {
      screen.rect(MARGIN + width - pad.x - 3, top + height - pad.y - 2, 3, 2, this.color)
    }
  }
}

/**
 * A list of choices in a box, in the middle of the screen. Up and down move the cursor,
 * the action button chooses: the menu closes and calls `onChoose`.
 */
export class Menu extends Thing {
  modal = true
  /** Color of the text (and of a plain box's border). */
  color = '#f4f4f4'
  /** The highlighted choice. */
  choice = 0

  constructor(
    readonly items: string[],
    private readonly onChoose: (index: number, item: string) => void,
  ) {
    super()
    if (items.length === 0) this.remove()
  }

  update() {
    const n = this.items.length
    if (input.pressed('up')) this.choice = (this.choice + n - 1) % n
    if (input.pressed('down')) this.choice = (this.choice + 1) % n
    if (input.pressed('action')) {
      this.remove()
      this.onChoose(this.choice, this.items[this.choice])
    }
  }

  drawUI() {
    const f = font()
    const pad = padding()
    const cursor = findSprite('cursor')
    const indent = (cursor ? cursor.width : f.advance('>')) + 3
    const textWidth = Math.max(...this.items.map((item) => f.lineWidth(item)))
    const width = textWidth + indent + pad.x * 2
    const height = this.items.length * f.lineHeight + pad.y * 2
    const left = Math.floor((screen.width - width) / 2)
    const top = Math.floor((screen.height - height) / 2)
    box(left, top, width, height, this.color)
    this.items.forEach((item, i) => {
      const y = top + pad.y + i * f.lineHeight
      screen.text(item, left + pad.x + indent, y, this.color)
      if (i !== this.choice) return
      if (cursor) screen.sprite(cursor, left + pad.x + cursor.origin.x, y + Math.floor(f.lineHeight / 2))
      else screen.text('>', left + pad.x, y, this.color)
    })
  }
}
