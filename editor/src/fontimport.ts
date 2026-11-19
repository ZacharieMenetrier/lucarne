// "Import a font" (in the menu): turns a pixel font into a game font, in fonts/.

import { h, openDialog, toast } from './dialog'
import { FONT_NAME_RE, fontFromFile, fontName, type ImportedFont } from './font'
import type { Project } from './project'

/** Pixel size asked for a .ttf when nothing better is known: the most common one. */
const DEFAULT_PIXEL_SIZE = 16

/** Asks for the font's files (the font, and its license if there is one), then imports it. */
export function importFont(project: Project) {
  const picker = h('input', { type: 'file', multiple: true, accept: '.ttf,.otf,.woff,.woff2,.txt,.md' })
  picker.addEventListener('change', () => void importFiles(project, [...(picker.files ?? [])]))
  picker.click()
}

async function importFiles(project: Project, files: File[]) {
  const source = files.find((f) => /\.(ttf|otf|woff2?)$/i.test(f.name))
  if (!source) return toast('Choose a pixel font file: .ttf, .otf or .woff.')
  const licenseFile = files.find((f) => f !== source && /\.(txt|md)$/i.test(f.name)) ?? null

  const name = h('input', { type: 'text', value: fontName(source.name), autocapitalize: 'off', autocomplete: 'off', spellcheck: false })
  const size = h('input', { type: 'number', min: '1', max: '128', value: String(DEFAULT_PIXEL_SIZE) })
  const body = h('div', { className: 'fields' },
    h('p', { className: 'muted' }, `From ${source.name}.`),
    h('label', {}, 'Name, in fonts/', name),
    h('label', {}, 'Size it is drawn for, in pixels (see its page: often 8, 12 or 16)', size),
    h('p', { className: 'muted' }, licenseFile
      ? `Its license (${licenseFile.name}) goes with it, in fonts/.`
      : 'No license file chosen: if the font has one, import it again with its license selected too.'),
  )
  const res = await openDialog('Import a font', body, [
    { label: 'Cancel', value: 'cancel' },
    { label: 'Import', value: 'ok', kind: 'primary' },
  ], (v) => {
    if (v !== 'ok') return null
    if (!FONT_NAME_RE.test(name.value)) return 'Use lowercase letters, digits, - and _.'
    if (!(Number(size.value) >= 1)) return 'The size is a number of pixels.'
    return null
  })
  if (res !== 'ok') return

  let font: ImportedFont
  try {
    font = await fontFromFile(await source.arrayBuffer(), Number(size.value))
  } catch (err) {
    return toast(`Could not read the font: ${(err as Error).message}`)
  }
  await project.saveFont(name.value, font, licenseFile ? await licenseFile.text() : null)
  toast(`Font "${name.value}": ${[...font.meta.characters].length} characters, in fonts/`)
}
