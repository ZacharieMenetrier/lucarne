// What the player does, as actions rather than keys: the game never sees a key.
//
// Keyboard: arrows or WASD (the same keys as ZQSD on an AZERTY keyboard),
// Space or Enter for the action. Gamepad: left stick or D-pad, A (bottom) button.
// The state is read once per update, so it never changes in the middle of one.

export type Button = 'left' | 'right' | 'up' | 'down' | 'action'

/** Physical keys (`KeyboardEvent.code`, independent of the keyboard layout). */
const KEYS: Record<string, Button> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyW: 'up',
  KeyS: 'down',
  Space: 'action',
  Enter: 'action',
}

const STICK_DEADZONE = 0.25

const held = new Set<string>()
/** Keys pressed since the last update, even if already released: a quick tap still counts. */
const tapped = new Set<string>()
let now = new Set<Button>()
let before = new Set<Button>()
let stick = { x: 0, y: 0 }

export const input = {
  /** Horizontal direction, from -1 (left) to 1 (right). */
  x: 0,
  /** Vertical direction, from -1 (up) to 1 (down). */
  y: 0,
  /** Is the button held? */
  down(button: Button) {
    return now.has(button)
  },
  /** Was the button pressed just now (true for one update only)? */
  pressed(button: Button) {
    return now.has(button) && !before.has(button)
  },
}

/** Reads keyboard and gamepads; called by the loop before each update. */
export function sampleInput() {
  before = now
  now = new Set()
  for (const code of [...held, ...tapped]) {
    const b = KEYS[code]
    if (b) now.add(b)
  }
  tapped.clear()
  stick = { x: 0, y: 0 }
  for (const pad of navigator.getGamepads?.() ?? []) {
    if (!pad) continue
    const [ax = 0, ay = 0] = pad.axes
    if (Math.hypot(ax, ay) > STICK_DEADZONE) stick = { x: ax, y: ay }
    const pressed = (i: number) => pad.buttons[i]?.pressed ?? false
    if (pressed(0)) now.add('action')
    if (pressed(12) || ay < -0.5) now.add('up')
    if (pressed(13) || ay > 0.5) now.add('down')
    if (pressed(14) || ax < -0.5) now.add('left')
    if (pressed(15) || ax > 0.5) now.add('right')
  }
  const digitalX = (now.has('right') ? 1 : 0) - (now.has('left') ? 1 : 0)
  const digitalY = (now.has('down') ? 1 : 0) - (now.has('up') ? 1 : 0)
  input.x = stick.x !== 0 || stick.y !== 0 ? stick.x : digitalX
  input.y = stick.x !== 0 || stick.y !== 0 ? stick.y : digitalY
}

function onKeyDown(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, dialog')) return
  if (!(e.code in KEYS)) return
  held.add(e.code)
  tapped.add(e.code)
  e.preventDefault()
}

function onKeyUp(e: KeyboardEvent) {
  held.delete(e.code)
}

function onBlur() {
  held.clear()
  tapped.clear()
}

/** Starts or stops listening to the keyboard (only while a game runs). */
export function listenInput(on: boolean) {
  if (on) {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
  } else {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
  }
  held.clear()
  tapped.clear()
  now = new Set()
  before = new Set()
  input.x = 0
  input.y = 0
}
