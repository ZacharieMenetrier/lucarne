// The values a map sets on a placed actor, next to its code's defaults. The code declares
// each variable with its default (see runtime/values.ts); the map holds only what is set
// for one placed actor, by name. No DOM here: the world page shows them.

/** What a map sets on a placed actor, by variable name. Read as it is: checked at play. */
export type Values = Record<string, unknown>

/** A value on one line, spaced like the rest of the game's files: `["a", "b"]`, `{ "x": 1 }`. */
export function inlineJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inlineJson).join(', ')}]`
  if (v && typeof v === 'object') {
    const parts = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inlineJson(x)}`)
    return parts.length ? `{ ${parts.join(', ')} }` : '{}'
  }
  return JSON.stringify(v)
}

/** The names a placed actor sets that the code does not declare (renamed, removed): to remove. */
export function staleNames(values: Values, variables: readonly { name: string }[]): string[] {
  return Object.keys(values).filter((n) => !variables.some((v) => v.name === n)).sort()
}

/** Are two values the same (a value set to what it already is changes nothing)? */
export function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}
