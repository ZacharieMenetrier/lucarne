// Pointer, pen and gestures.
//
// - Mouse and pen draw. Fingers never draw (the palm is ignored).
// - One finger held still: eyedropper (sprite pixel, or the board color);
//   keep it down and slide to pick other colors.
// - Two fingers: zoom and pan. Two-finger tap: undo. Three-finger tap: redo.
// - Mouse: wheel or trackpad to pan, pinch or ⌥/⌘ + wheel to zoom,
//   middle button or space + drag to pan.
// - Dragging a sprite's name moves it, whatever the tool. Double tap on a
//   name (or on a sprite with the Move tool) zooms in on that sprite.

import { colorToCss } from './color'
import type { Editor, PointerInput } from './editor'
import type { View } from './view'

const TAP_MAX_MS = 300
const TAP_MAX_MOVE = 12
const DOUBLE_TAP_MS = 350
const LONG_PRESS_MS = 400

interface Gesture {
  startTime: number
  maxTouches: number
  moved: boolean
  // Baseline, recomputed when the number of fingers changes
  dist0: number
  midX0: number
  midY0: number
  zoom0: number
  ox0: number
  oy0: number
}

export function attachInput(canvas: HTMLCanvasElement, view: View, editor: Editor) {
  const touches = new Map<number, { x: number; y: number }>()
  let gesture: Gesture | null = null
  let drawingId: number | null = null
  let penDown = false
  let panning: { id: number; x: number; y: number } | null = null
  let spaceDown = false

  let lastTap = { name: '', time: 0, x: 0, y: 0 }

  // One finger held still: eyedropper. Once it fires, sliding keeps picking.
  let press: { id: number; x0: number; y0: number; x: number; y: number; timer: ReturnType<typeof setTimeout>; active: boolean; last: string } | null = null

  // Loupe above the finger while picking: top half, the color under the
  // finger; bottom half, the color before the long press.
  const loupe = document.createElement('div')
  loupe.className = 'loupe'
  loupe.hidden = true
  document.body.append(loupe)

  function moveLoupe(clientX: number, clientY: number) {
    // Above the finger, or below it near the top of the screen.
    const y = clientY - 90 < 40 ? clientY + 90 : clientY - 90
    loupe.style.transform = `translate(${clientX}px, ${y}px) translate(-50%, -50%)`
  }

  function cancelPress() {
    if (press) clearTimeout(press.timer)
    press = null
    loupe.hidden = true
  }

  function pickUnder(clientX: number, clientY: number) {
    if (!press) return
    moveLoupe(clientX, clientY)
    const p = view.toBoard(clientX, clientY)
    const key = `${p.x},${p.y}`
    if (key === press.last) return
    press.last = key
    const { color, ok } = editor.pickAt(p, view.boardColor)
    loupe.style.setProperty('--picked', colorToCss(color))
    loupe.classList.toggle('off-palette', !ok)
  }

  const toInput = (e: PointerEvent): PointerInput => ({
    ...view.toBoard(e.clientX, e.clientY),
    shift: e.shiftKey,
    alt: e.altKey,
  })

  // --- Multi-finger gestures -----------------------------------------------

  function twoFingers() {
    const [a, b] = [...touches.values()]
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    }
  }

  function rebase() {
    if (!gesture || touches.size < 2) return
    const { dist, midX, midY } = twoFingers()
    Object.assign(gesture, { dist0: dist, midX0: midX, midY0: midY, zoom0: view.zoomRaw, ox0: view.ox, oy0: view.oy })
  }

  function touchDown(e: PointerEvent) {
    touches.set(e.pointerId, view.toDevice(e.clientX, e.clientY))
    if (touches.size === 1 && !gesture) {
      const { clientX, clientY, pointerId } = e
      press = {
        id: pointerId,
        x0: clientX,
        y0: clientY,
        x: clientX,
        y: clientY,
        active: false,
        last: '',
        timer: setTimeout(() => {
          if (!press) return
          press.active = true
          loupe.style.setProperty('--before', colorToCss(editor.color))
          loupe.hidden = false
          pickUnder(press.x, press.y)
        }, LONG_PRESS_MS),
      }
    } else cancelPress()
    if (touches.size >= 2) {
      if (!gesture) {
        gesture = { startTime: performance.now(), maxTouches: 0, moved: false, dist0: 0, midX0: 0, midY0: 0, zoom0: 0, ox0: 0, oy0: 0 }
      }
      gesture.maxTouches = Math.max(gesture.maxTouches, touches.size)
      rebase()
    }
  }

  function touchMove(e: PointerEvent) {
    if (!touches.has(e.pointerId)) return
    touches.set(e.pointerId, view.toDevice(e.clientX, e.clientY))
    if (press?.id === e.pointerId) {
      if (press.active) return pickUnder(e.clientX, e.clientY)
      if (Math.hypot(e.clientX - press.x0, e.clientY - press.y0) > TAP_MAX_MOVE) cancelPress()
      else {
        press.x = e.clientX
        press.y = e.clientY
      }
    }
    if (!gesture || touches.size < 2) return
    const { dist, midX, midY } = twoFingers()
    if (Math.abs(dist - gesture.dist0) > TAP_MAX_MOVE * view.dpr || Math.hypot(midX - gesture.midX0, midY - gesture.midY0) > TAP_MAX_MOVE * view.dpr) {
      gesture.moved = true
    }
    if (!gesture.moved) return
    // The sprite pixel under the fingers' midpoint follows the fingers.
    const z0 = Math.min(128, Math.max(1, Math.round(gesture.zoom0)))
    const sx = (gesture.midX0 - gesture.ox0) / z0
    const sy = (gesture.midY0 - gesture.oy0) / z0
    view.zoomRaw = Math.min(128, Math.max(1, gesture.zoom0 * (dist / gesture.dist0)))
    view.ox = Math.round(midX - sx * view.zoom)
    view.oy = Math.round(midY - sy * view.zoom)
    view.requestRender()
  }

  function touchUp(e: PointerEvent) {
    if (!touches.delete(e.pointerId)) return
    if (press?.id === e.pointerId) cancelPress()
    if (touches.size >= 2) return rebase()
    if (touches.size === 0 && gesture) {
      const g = gesture
      gesture = null
      if (!g.moved && performance.now() - g.startTime < TAP_MAX_MS) {
        if (g.maxTouches === 2) editor.undo()
        else if (g.maxTouches === 3) editor.redo()
      }
    }
  }

  function isDoubleTap(name: string, e: PointerEvent) {
    const now = performance.now()
    const double =
      lastTap.name === name &&
      now - lastTap.time < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < TAP_MAX_MOVE
    lastTap = double ? { name: '', time: 0, x: 0, y: 0 } : { name, time: now, x: e.clientX, y: e.clientY }
    return double
  }

  // --- Events ---------------------------------------------------------------

  const capture = (id: number) => {
    try {
      canvas.setPointerCapture(id)
    } catch {
      // Pointer already released: not important.
    }
  }


  canvas.addEventListener('pointerdown', (e) => {
    // Drawing takes focus away from any text field (e.g. the sprite name).
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
    if (e.pointerType === 'touch') {
      if (!penDown) touchDown(e)
      return
    }
    e.preventDefault()
    if (e.pointerType === 'mouse' && (e.button === 1 || (e.button === 0 && spaceDown))) {
      panning = { id: e.pointerId, ...view.toDevice(e.clientX, e.clientY) }
      capture(e.pointerId)
      return
    }
    if (e.button !== 0 || drawingId !== null) return
    const p = toInput(e)
    const handle = editor.tool === 'move' ? view.handleAt(e.clientX, e.clientY) : null
    const target = editor.tool === 'move' && !handle ? editor.hitTest(p) : null
    if (target && isDoubleTap(target, e)) {
      view.focus(target, true)
      return
    }
    if (e.pointerType === 'pen') {
      penDown = true
      // A hand resting on the screen must not zoom or pick while drawing.
      touches.clear()
      cancelPress()
      gesture = null
    }
    drawingId = e.pointerId
    capture(e.pointerId)
    if (handle) editor.startResize(handle.name, handle.corner, p)
    else editor.down(p)
  })

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return touchMove(e)
    if (panning?.id === e.pointerId) {
      const d = view.toDevice(e.clientX, e.clientY)
      view.pan(d.x - panning.x, d.y - panning.y)
      panning.x = d.x
      panning.y = d.y
      return
    }
    if (drawingId === e.pointerId) {
      // Every intermediate point, for a continuous pen stroke.
      const events = e.getCoalescedEvents?.() ?? []
      for (const ce of events.length ? events : [e]) editor.move(toInput(ce))
    } else {
      view.hoverHandle = editor.tool === 'move' && !panning ? view.handleAt(e.clientX, e.clientY) : null
      editor.move(toInput(e))
    }
  })

  const end = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return touchUp(e)
    if (panning?.id === e.pointerId) {
      panning = null
      return
    }
    if (drawingId !== e.pointerId) return
    drawingId = null
    if (e.pointerType === 'pen') penDown = false
    editor.up(toInput(e))
  }
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'touch' && drawingId === null) {
      view.hoverHandle = null
      editor.leave()
    }
  })

  canvas.addEventListener('contextmenu', (e) => e.preventDefault())

  // Safari (macOS) reports trackpad pinches as GestureEvents with a cumulative
  // `scale`, not as ctrl + wheel like other browsers.
  let safariPinch: { zoom0: number; x: number; y: number } | null = null

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      if (safariPinch && e.ctrlKey) return // already handled by gesturechange
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      const d = view.toDevice(e.clientX, e.clientY)
      if (e.ctrlKey || e.metaKey || e.altKey) {
        // Trackpad pinch (ctrlKey) or modifier + wheel
        view.zoomAt(view.zoomRaw * Math.exp(-e.deltaY * unit * 0.01), d.x, d.y)
      } else {
        view.pan(-e.deltaX * unit * view.dpr, -e.deltaY * unit * view.dpr)
      }
    },
    { passive: false },
  )

  // Stops Safari from zooming the whole page.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault())
  }

  type SafariGesture = Event & { scale: number; clientX: number; clientY: number }
  canvas.addEventListener('gesturestart', (e) => {
    // On iPad, fingers are already tracked as touch pointers: ignore the duplicate.
    if (touches.size > 0) return
    const g = e as SafariGesture
    safariPinch = { zoom0: view.zoomRaw, ...view.toDevice(g.clientX, g.clientY) }
  })
  canvas.addEventListener('gesturechange', (e) => {
    if (!safariPinch || touches.size > 0) return
    view.zoomAt(safariPinch.zoom0 * (e as SafariGesture).scale, safariPinch.x, safariPinch.y)
  })
  canvas.addEventListener('gestureend', () => {
    safariPinch = null
  })

  return {
    setSpace(down: boolean) {
      spaceDown = down
      canvas.style.cursor = down ? 'grab' : ''
    },
  }
}
