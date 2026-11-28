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
// A value set in the editor is data, on the map, for one placed villager: the code's default
// holds for every other. A value is the code's default, then the map's, then spawn's: the
// last set wins (see `spawn` in world.ts).
//
// Position (x, y) is where an actor is placed, and its box is the code's (see `Actor`):
// neither is a variable.

/** What a variable holds, which says how the editor edits it. */
export type VariableKind = 'number' | 'text' | 'switch' | 'lines'

export type Value = number | string | boolean | string[]

export interface Variable {
  name: string
  kind: VariableKind
  /** Its default: the value the code gives it. */
  value: Value
}

/** Fields of every actor that are not variables of its kind. */
const NOT_VARIABLES = new Set(['x', 'y', 'box'])

/**
 * The kind of a default value, or null: a field of another kind is not a variable. A list
 * is a list of lines when its default holds lines: an empty one says nothing of what it
 * will hold (`targets: Actor[] = []` is no list of lines), so it is not a variable.
 */
export function kindOf(value: unknown): VariableKind | null {
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : null
  if (typeof value === 'string') return 'text'
  if (typeof value === 'boolean') return 'switch'
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')) return 'lines'
  return null
}

/**
 * The variables of an actor, from an instance that has only its code's defaults: its own
 * fields of a simple kind, in the order the code declares them. A field of another kind
 * (an object, a function, a list of numbers) is the code's own business.
 */
export function variablesOf(actor: object): Variable[] {
  const out: Variable[] = []
  for (const [name, value] of Object.entries(actor)) {
    if (NOT_VARIABLES.has(name)) continue
    const kind = kindOf(value)
    if (kind) out.push({ name, kind, value: copyValue(value as Value) })
  }
  return out
}

/** Is it a value of that kind? */
export function isValue(kind: VariableKind, v: unknown): v is Value {
  // A value set may be an empty list: a sign that says nothing.
  if (kind === 'lines') return Array.isArray(v) && v.every((x) => typeof x === 'string')
  return kindOf(v) === kind
}

/** A copy that shares nothing: two actors never share a list. */
export function copyValue<T extends Value>(v: T): T {
  return (Array.isArray(v) ? [...v] : v) as T
}

const KIND_NAMES: Record<VariableKind, string> = {
  number: 'a number',
  text: 'text',
  switch: 'true or false',
  lines: 'a list of lines of text',
}

/**
 * Checks values read from a file against an actor's variables, and returns copies of them.
 * Throws on a name that is not a variable, or a value of the wrong kind, saying where:
 * `file` ("maps/village.json") and `actor` ("villager").
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
