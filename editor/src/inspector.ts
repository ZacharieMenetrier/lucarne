// The inspector: an actor's variables, one row each, to set their values in the editor. The
// world page uses it for the actors selected on the maps (each one alone).
//
// Each row shows the value the game will see. A value set here has its name in bold, and ↺
// next to it to clear it (the code's default comes back): nothing else marks it.
//
// A row is selected by clicking it (its name too: no keyboard comes up on the iPad) or a
// field of it: the row being worked on, lit softly across the panel (fainter on hover).
// Escape leaves it. Nothing is selected at first.
//
// A true-or-false variable is a switch, at the right of its name. ↺ follows the name it
// clears, so the controls alone keep the right edge, lined up from row to row.
//
// A value the code does not accept stops the game with an error naming it: the inspector
// shows it too, its name in red, to fix here. A value set for a variable the code no longer
// declares (renamed, removed) is listed last, struck through, for ↺ to remove.

import { isValue, type Variable } from '../../runtime/values'
import { h } from './dialog'
import { icon } from './icons'

export interface Row {
  variable: Variable
  /** The value the game will see (with `mixed`: one of them). */
  value: unknown
  /** Set here: ↺ clears it. Otherwise it is the code's default. */
  own: boolean
  /** Several actors are edited at once, and their values differ. */
  mixed?: boolean
}

type Field = HTMLInputElement | HTMLTextAreaElement

interface RowView {
  root: HTMLElement
  label: HTMLLabelElement
  reset: HTMLButtonElement
  /** Shows the row's value in its fields, unless one is being typed in. */
  fill: (r: Row) => void
}

export class Inspector {
  readonly root = h('div', { className: 'inspector' })
  /** A value set at this layer, or cleared (undefined). */
  onSet: (name: string, value: unknown) => void = () => {}
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
  }

  private build(variable: Variable): RowView {
    const { name, kind } = variable
    const reset = h('button', {
      type: 'button',
      className: 'icon inspector-reset',
      title: "Clear it: take the code's default again",
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

  private update(v: RowView, r: Row) {
    const invalid = !r.mixed && !isValue(r.variable.kind, r.value)
    v.root.classList.toggle('own', r.own)
    v.root.classList.toggle('invalid', invalid)
    const where = r.own ? 'set here' : "the code's default"
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
