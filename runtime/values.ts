// Variables: what the editor can set on an actor, and how a value read from a file is checked.
//
// The code declares, the editor sets. A variable is a field of an actor class whose default
// is of a simple kind, declared in the code like any field:
//
//   export default class Villager extends Actor {
//     speed = 0.5                 // a number
//     lines = ['Hello!']          // a list of lines of text
//   }
//
// Its value, once set in the editor, is data: actors/villager.json for every villager, a map
// for one placed villager. The box is a variable too, the engine's own: every actor has one
// (null: none), and it is set by drawing it. A value is looked up in this order, the last
// one set winning: the code's default, then each parent's actor file, then the actor's own
// file, then the placed actor (see `spawn` in world.ts).
//
// Position (x, y) is where an actor is placed, not a variable of its kind, and `modal` says
// what a class is in the code (a menu, a dialogue): neither is set in an actor file.

import type { Box } from './collision'

/** What a variable holds, which says how the editor edits it. */
export type VariableKind = 'number' | 'text' | 'switch' | 'lines' | 'box'

export type Value = number | string | boolean | string[] | Box | null

export interface Variable {
  name: string
  kind: VariableKind
  /** Its default: the value the code gives it. */
  value: Value
}

/** Fields of every actor that are not variables of its kind. */
const NOT_VARIABLES = new Set(['x', 'y', 'modal'])

/**
 * The kind of a default value, or null: a field of another kind is not a variable. A list
 * is a list of lines when its default holds lines: an empty one says nothing of what it
 * will hold (`targets: Actor[] = []` is no list of lines), so it is not a variable.
 */
export function kindOf(value: unknown): Exclude<VariableKind, 'box'> | null {
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : null
  if (typeof value === 'string') return 'text'
  if (typeof value === 'boolean') return 'switch'
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')) return 'lines'
  return null
}

/**
 * The variables of an actor, from an instance that has only its code's defaults: its own
 * fields of a simple kind, in the order the code declares them, the box first. A field
 * of another kind (an object, a function, a list of numbers) is the code's own business.
 */
export function variablesOf(actor: object): Variable[] {
  const out: Variable[] = []
  for (const [name, value] of Object.entries(actor)) {
    if (NOT_VARIABLES.has(name)) continue
    const kind = name === 'box' ? 'box' : kindOf(value)
    if (kind) out.push({ name, kind, value: copyValue(value as Value) })
  }
  return out
}

/** Is it a value of that kind? A box has whole pixels, and is at least one pixel each way. */
export function isValue(kind: VariableKind, v: unknown): v is Value {
  if (kind === 'box') {
    if (v === null) return true
    if (!v || typeof v !== 'object') return false
    const b = v as Record<string, unknown>
    return [b.x, b.y, b.width, b.height].every(Number.isInteger) && (b.width as number) >= 1 && (b.height as number) >= 1
  }
  // A value set may be an empty list: a sign that says nothing.
  if (kind === 'lines') return Array.isArray(v) && v.every((x) => typeof x === 'string')
  return kindOf(v) === kind
}

/** A copy that shares nothing: two actors never share a list or a box. */
export function copyValue<T extends Value>(v: T): T {
  if (Array.isArray(v)) return [...v] as T
  if (v && typeof v === 'object') {
    const b = v as Box
    return { x: b.x, y: b.y, width: b.width, height: b.height } as T
  }
  return v
}

const KIND_NAMES: Record<VariableKind, string> = {
  number: 'a number',
  text: 'text',
  switch: 'true or false',
  lines: 'a list of lines of text',
  box: 'a box ({ "x", "y", "width", "height" } in whole pixels) or null',
}

/**
 * Checks values read from a file against an actor's variables, and returns copies of them.
 * Throws on a name that is not a variable, or a value of the wrong kind, saying where:
 * `file` ("actors/villager.json") and `actor` ("villager").
 */
export function checkValues(values: Record<string, unknown>, variables: readonly Variable[], file: string, actor: string): Record<string, Value> {
  const out: Record<string, Value> = {}
  for (const [name, v] of Object.entries(values)) {
    const variable = variables.find((x) => x.name === name)
    if (!variable) {
      const known = variables.map((x) => x.name).join(', ')
      throw new Error(`${file} sets "${name}", but the ${actor} has no variable named so (its variables: ${known}). Declare it in actors/${actor}.ts, or remove it in the editor.`)
    }
    if (!isValue(variable.kind, v)) {
      throw new Error(`${file}: "${name}" of the ${actor} must be ${KIND_NAMES[variable.kind]}, not ${JSON.stringify(v)}.`)
    }
    out[name] = copyValue(v)
  }
  return out
}
