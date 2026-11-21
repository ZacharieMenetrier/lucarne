// The inspector: an actor's variables, one row each, to set their values in the editor. The
// Actors page uses it for an actor file (every actor of that kind), the world page for the
// actors selected on the maps (each one alone).
//
// Each row shows the value the game will see. A value set at this layer has its name in
// bold, and ↺ next to it to clear it: nothing else marks it. Where an inherited value
// comes from (the code, a parent's file) is in the name's tooltip, not on screen: what
// matters while editing is "set here or not". Editing a value sets it at this layer.
//
// A row is selected by clicking it (its name too: no keyboard comes up on the iPad) or a
// field of it: the row being worked on, lit softly across the panel (fainter on hover). Every row selects alike; the box,
// selected, is also drawn on the actor, to move and resize it there (the page draws it
// only then). Escape leaves it. Nothing is selected at first.
//
// The box is a row like the others: at the right of its name a switch, with what it means
// ("Solid", or "Goes through everything"), then its four numbers, gone when off. A
// true-or-false variable is a switch too, at the right of its name. ↺ follows the name it
// clears, so the controls alone keep the right edge, lined up from row to row.
//
// A value the code does not accept stops the game with an error naming it: the inspector
// shows it too, its name in red, to fix here. A value set for a variable the code no longer
// declares (renamed, removed) is listed last, struck through, for ↺ to remove.

import type { Box } from '../../runtime/collision'
import { isValue, type Variable } from '../../runtime/values'
import { setBoxField } from './actors'
import { h } from './dialog'
import { icon } from './icons'

export interface Row {
  variable: Variable
  /** The value the game will see (with `mixed`: one of them). */
  value: unknown
  /** What sets it: null for the code's default, else the actor file (or map) that does. */
  from: string | null
  /** Set at this layer: ↺ clears it. */
  own: boolean
  /** Several actors are edited at once, and their values differ. */
  mixed?: boolean
  /** A box: what unticking "none" sets (undefined: clear it, to take the inherited box). */
  whenOn?: Box
}

type Field = HTMLInputElement | HTMLTextAreaElement

interface RowView {
  root: HTMLElement
  label: HTMLLabelElement
  reset: HTMLButtonElement
  /** Shows the row's value in its fields, unless one is being typed in. */
  fill: (r: Row) => void
}

const BOX_FIELDS = [['x', 'X'], ['y', 'Y'], ['width', 'W'], ['height', 'H']] as const

export class Inspector {
  readonly root = h('div', { className: 'inspector' })
  /** A value set at this layer, or cleared (undefined). */
  onSet: (name: string, value: unknown) => void = () => {}
  /** The row selected changed (null: none): a box selected is drawn on the actor. */
  onSelect: (name: string | null) => void = () => {}
  /** The row worked on, if any. */
  selected: string | null = null
  private views = new Map<string, RowView>()
  private key = ''
  private rows: readonly Row[] = []
  private stale: readonly string[] = []
  private readonly staleList = h('div', { className: 'inspector-stale' })

  /**
   * Shows these rows, then the values set at this layer that the code does not declare
   * (`stale`). Rows for the same variables are updated in place: a field being typed in
   * keeps its focus and its text.
   */
  show(rows: readonly Row[], stale: readonly string[] = []) {
    this.rows = rows
    this.stale = stale
    const key = rows.map((r) => `${r.variable.name}:${r.variable.kind}`).join(',')
    if (key !== this.key || !this.root.contains(this.staleList)) {
      this.key = key
      this.views = new Map(rows.map((r) => [r.variable.name, this.build(r.variable)]))
      this.root.replaceChildren(...[...this.views.values()].map((v) => v.root), this.staleList)
      if (this.selected && !this.views.has(this.selected)) this.select(null)
    }
    for (const r of rows) this.update(this.views.get(r.variable.name)!, r)
    this.staleList.replaceChildren(...stale.map((name) =>
      h('div', { className: 'inspector-row invalid stale' },
        h('div', { className: 'inspector-head' },
          h('label', { title: 'Not in the code: ↺ removes it' }, name),
          h('button', {
            type: 'button',
            className: 'icon inspector-reset',
            title: `Remove ${name}: the code declares no such variable`,
            'aria-label': `Remove ${name}`,
            html: icon('undo'),
            onclick: () => this.onSet(name, undefined),
          })))))
  }

  /** Selects a row (null: none), and says so. */
  select(name: string | null) {
    if (name === this.selected) return
    this.selected = name
    for (const [n, v] of this.views) v.root.classList.toggle('selected', n === name)
    this.onSelect(name)
  }

  private build(variable: Variable): RowView {
    const { name, kind } = variable
    const reset = h('button', {
      type: 'button',
      className: 'icon inspector-reset',
      title: 'Clear it here: take the inherited value again',
      'aria-label': `Clear ${name}`,
      html: icon('undo'),
      onclick: () => this.onSet(name, undefined),
    })
    const label = h('label', {}, name)
    // ↺ follows the name it clears; the controls keep the right edge, lined up row to row.
    const head = h('div', { className: 'inspector-head' }, label, reset, h('span', { className: 'spacer' }))
    const root = h('div', { className: `inspector-row kind-${kind}` }, head)
    root.addEventListener('pointerdown', () => this.select(name))
    root.addEventListener('focusin', () => this.select(name))
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      ;(e.target as HTMLElement).blur()
      this.select(null)
      e.stopPropagation()
    })
    if (kind === 'box') return { root, label, reset, ...this.buildBox(name, head, root) }

    // The name is not the field's <label>: clicking it selects the row without typing.
    const id = `var-${name}`
    label.id = `${id}-name`
    let field: Field
    const commit = () => {
      const v = readField(field, kind)
      if (v !== undefined) this.onSet(name, v)
      // Not a value (letters in a number): the field shows the value again, once left.
      else setTimeout(() => this.show(this.rows, this.stale))
    }
    if (kind === 'lines') {
      field = h('textarea', { id, rows: 3, spellcheck: false, 'aria-labelledby': label.id, onchange: commit })
    } else {
      field = h('input', {
        id,
        'aria-labelledby': label.id,
        // A number is typed as text: a number field follows the system's language (a comma
        // in French) and empties itself on a dot. The iPad still shows a number pad.
        type: kind === 'switch' ? 'checkbox' : 'text',
        className: kind === 'switch' ? 'switch' : undefined,
        inputMode: kind === 'number' ? 'decimal' : undefined,
        autocomplete: 'off',
        spellcheck: false,
        onchange: commit,
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter') (e.target as HTMLElement).blur()
        },
      })
    }
    // A switch sits on its name's line, before ↺; the other fields go under it.
    if (kind === 'switch') head.append(field)
    else root.append(field)
    const fill = (r: Row) => {
      if (document.activeElement === field) return
      if (field instanceof HTMLInputElement && field.type === 'checkbox') {
        field.checked = r.value === true
        field.indeterminate = !!r.mixed
      } else {
        field.value = r.mixed ? '' : kind === 'lines' && Array.isArray(r.value) ? r.value.join('\n') : String(r.value)
        field.placeholder = r.mixed ? '—' : ''
        if (field instanceof HTMLTextAreaElement) field.rows = Math.max(2, Math.min(8, field.value.split('\n').length + 1))
      }
    }
    return { root, label, reset, fill }
  }

  /** The box: solid or not, then X Y W H, typed (↑ ↓ by one, ⇧ by ten). */
  private buildBox(name: string, head: HTMLElement, root: HTMLElement) {
    let current: Row | null = null
    const box = () => (current && isValue('box', current.value) ? (current.value as Box | null) : null)
    const solid = h('input', {
      type: 'checkbox',
      className: 'switch',
      title: 'Solid: walls and the other actors stop it. Off: it goes through everything',
      'aria-label': 'Solid',
      onchange: () => this.onSet(name, solid.checked ? current?.whenOn : null),
    })
    const says = h('span', { className: 'muted' })
    const set = (field: keyof Box, n: number) => {
      const b = box()
      if (b) this.onSet(name, setBoxField(b, field, n))
    }
    const inputs = BOX_FIELDS.map(([field, letter]) => {
      const input = h('input', {
        type: 'text',
        inputMode: 'numeric',
        autocomplete: 'off',
        spellcheck: false,
        'aria-label': `${name} ${field}`,
        onchange: () => {
          const n = Number(input.value.trim().replace(',', '.').replace('−', '-'))
          if (input.value.trim() !== '' && Number.isFinite(n)) set(field, n)
          else setTimeout(() => this.show(this.rows, this.stale))
        },
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter') input.blur()
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            const b = box()
            if (!b) return
            e.preventDefault()
            set(field, b[field] + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1))
            input.value = String(box()![field])
            input.select()
          }
        },
      })
      return { field, input, cell: h('label', { className: 'inspector-box-field' }, h('span', {}, letter), input) }
    })
    // The switch and its words are one label, on the name's line: a click on the words flips it too.
    head.append(h('label', { className: 'inspector-solid' }, says, solid))
    root.append(h('div', { className: 'inspector-box' }, ...inputs.map((i) => i.cell)))
    const fill = (r: Row) => {
      current = r
      const b = box()
      solid.checked = b !== null
      says.textContent = b ? 'Solid' : 'Goes through everything'
      root.classList.toggle('no-box', !b)
      for (const { field, input } of inputs) {
        if (document.activeElement !== input) input.value = b ? String(b[field]) : ''
      }
    }
    return { fill }
  }

  private update(v: RowView, r: Row) {
    const invalid = !r.mixed && !isValue(r.variable.kind, r.value)
    v.root.classList.toggle('own', r.own)
    v.root.classList.toggle('invalid', invalid)
    const where = r.own ? 'set here' : r.from === null ? "the code's default" : `from ${r.from}`
    v.label.title = r.mixed ? 'differs between the actors selected' : invalid ? `wrong kind of value, ${where}` : where
    v.reset.hidden = !r.own
    v.fill(r)
  }
}

/** A field's value as its variable's kind, or undefined when it holds none (not a number).
 * A number takes a dot or a comma. A list of lines has one line of text per line of the field. */
function readField(f: Field, kind: Variable['kind']): unknown {
  if (f instanceof HTMLInputElement && f.type === 'checkbox') return f.checked
  if (kind === 'number') {
    const text = f.value.trim().replace(',', '.')
    const n = text === '' ? NaN : Number(text)
    return Number.isFinite(n) ? n : undefined
  }
  if (kind === 'lines') return f.value === '' ? [] : f.value.split('\n')
  return f.value
}
