// Small modal dialogs and toast messages.

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || (v === false && !(k in el))) continue
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener)
    else if (k === 'html') el.innerHTML = String(v)
    else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children) if (c !== null && c !== undefined) el.append(c)
  return el
}

export interface DialogButton {
  label: string
  value: string
  /** 'left' puts a plain button on the left, like 'danger'. */
  kind?: 'primary' | 'danger' | 'left'
}

/**
 * Opens a modal dialog. Resolves with the chosen button's value, or null if it
 * is dismissed. `validate` can block closing by returning an error message.
 */
export function openDialog(
  title: string,
  body: HTMLElement,
  buttons: DialogButton[],
  validate?: (value: string) => string | null,
  className = '',
): Promise<string | null> {
  return new Promise((resolve) => {
    const error = h('p', { className: 'dialog-error' })
    const form = h('form', { method: 'dialog' }, h('h2', {}, title), body, error)
    const actions = h('div', { className: 'dialog-actions' })
    // The primary button comes first in the DOM (Enter triggers it); the CSS
    // reverses the order so it shows on the right.
    const ordered = [...buttons].reverse().sort((a, b) => Number(b.kind === 'primary') - Number(a.kind === 'primary'))
    for (const b of ordered) {
      actions.append(h('button', { type: 'submit', value: b.value, className: b.kind ?? '' }, b.label))
    }
    form.append(actions)
    const dialog = h('dialog', { className }, form)
    document.body.append(dialog)

    form.addEventListener('submit', (e) => {
      const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null
      const value = submitter?.value ?? buttons.find((b) => b.kind === 'primary')?.value ?? ''
      e.preventDefault()
      if (value !== 'cancel' && validate) {
        const message = validate(value)
        if (message) {
          error.textContent = message
          return
        }
      }
      dialog.close(value)
    })
    dialog.addEventListener('close', () => {
      const v = dialog.returnValue
      dialog.remove()
      resolve(v && v !== 'cancel' ? v : null)
    })
    dialog.showModal()
    body.querySelector<HTMLInputElement>('input')?.select()
  })
}

export async function confirmDialog(title: string, message: string, ok: string, danger = false) {
  const res = await openDialog(title, h('p', {}, message), [
    { label: 'Cancel', value: 'cancel' },
    { label: ok, value: 'ok', kind: danger ? 'danger' : 'primary' },
  ])
  return res === 'ok'
}

let toastTimer = 0

export function toast(message: string) {
  const el = document.getElementById('toast')!
  el.textContent = message
  el.classList.add('visible')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.classList.remove('visible'), 2200)
}
