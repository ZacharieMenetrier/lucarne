#!/usr/bin/env node
// Prepares the built-in instruments (runtime/instruments/) from their source recordings,
// the way the editor imports a recording: from the start of the note, cut where it should
// end, 16 kHz, 8-bit, its note detected.
//
//   node scripts/instruments.mjs <folder of sources>
//
// The sources are named after the instruments (flute.aif, harp.wav…), downloaded from the
// addresses below. AIFF files are converted with macOS's afconvert first.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RATE, decodeWav, detectPitch, encodeWav, frequency, noteName, noteNumber, prepareRecording, serializeInstrumentFile, tuneRecording } from '../runtime/sound.ts'

const IOWA = 'University of Iowa Electronic Music Studios, Musical Instrument Samples (theremin.music.uiowa.edu/MIS.html): "freely available … may be downloaded and used for any projects, without restrictions."'
const VSCO = 'Versilian Studios, VSCO 2 Community Edition (github.com/sgossner/VSCO-2-CE), CC0 1.0.'

/**
 * Every built-in instrument: its source, the note it plays (checked against what is
 * detected), and `cut`, the seconds of recording kept at most, when the player does
 * something at the end that should not repeat (a swell of the bow). `volume`, in dB, set by
 * ear on songs: what the engine's measure of loudness misses (0 when left out).
 */
const INSTRUMENTS = [
  // Winds
  { name: 'flute', note: 'C5', source: 'Flute.nonvib.ff.C5', by: IOWA },
  { name: 'alto-flute', note: 'C5', source: 'AltoFlute.vib.ff.C5', by: IOWA },
  { name: 'oboe', note: 'C5', source: 'Oboe.ff.C5', by: IOWA },
  { name: 'bassoon', note: 'C3', source: 'Bassoon.ff.C3', by: IOWA },
  { name: 'horn', note: 'C4', source: 'Horn.ff.C4', by: IOWA },
  { name: 'trumpet', note: 'C5', source: 'Trumpet.novib.ff.C5', by: IOWA },
  { name: 'organ', source: 'Keys/Organ/Loud/Rode_Man3Open_25', by: `${VSCO} Organ sampled by Simon Dalzell of Ivy Audio.` },
  // Strings
  { name: 'violin', note: 'C5', source: 'Violin.arco.ff.sulA.C5', cut: 1.9, by: IOWA },
  { name: 'viola', note: 'C4', source: 'Viola.arco.ff.sulC.C4', by: IOWA },
  { name: 'cello', note: 'C#3', source: 'Cello.arco.ff.sulC.C3 (the open string, tuned high: it plays C#3)', volume: 3, by: IOWA },
  { name: 'cello-pizzicato', note: 'C3', source: 'Cello.pizz.ff.sulC.C3', volume: 10, by: IOWA },
  { name: 'harp', note: 'C5', source: 'Strings/Harp/KSHarp_C5_mf', volume: 3, by: VSCO },
  // Struck
  { name: 'bells', note: 'C6', source: 'bells.brass.ff.C6', volume: 2, by: IOWA },
  { name: 'marimba', note: 'C5', source: 'Marimba.yarn.ff.C5', volume: 7, by: IOWA },
  // Drums: no note, they always play as recorded.
  { name: 'bass-drum', drum: true, source: 'Percussion/BDrumNewhit_v4_rr1_Sum', volume: 12, by: VSCO },
  { name: 'tenor-drum', drum: true, source: 'Percussion/timpsnaretenor_f', volume: 2, by: VSCO },
  { name: 'snare', drum: true, source: 'Percussion/Snare2-HitSN_v5_rr1_Sum', volume: 2, by: VSCO },
  { name: 'tambourine', drum: true, source: 'Percussion/Tamb1-Hit_v2_rr1_Sum', volume: 4, by: VSCO },
  { name: 'triangle', drum: true, source: 'Percussion/Triangle3-Hit_v1_rr1_Sum', by: VSCO },
  { name: 'claves', drum: true, source: 'Percussion/Claves1_Hit_v2_rr1_Sum', by: VSCO },
]

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.resolve(here, '../runtime/instruments')
const sources = process.argv[2]
if (!sources) {
  console.error('Usage: node scripts/instruments.mjs <folder of sources>')
  process.exit(1)
}

function read(name) {
  const wav = path.join(sources, `${name}.wav`)
  if (fs.existsSync(wav)) return decodeWav(new Uint8Array(fs.readFileSync(wav)))
  const aif = path.join(sources, `${name}.aif`)
  const tmp = path.join(os.tmpdir(), `lucarne-${name}.wav`)
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', aif, tmp])
  return decodeWav(new Uint8Array(fs.readFileSync(tmp)))
}

fs.mkdirSync(out, { recursive: true })
const credits = ['# Built-in instruments', '', 'Prepared by `scripts/instruments.mjs` (16 kHz, 8-bit, cut as the editor imports). Sources:', '']
for (const inst of INSTRUMENTS) {
  const { data, rate } = read(inst.name)
  const src = inst.cut ? data.subarray(0, Math.round(inst.cut * rate) + firstSound(data)) : data
  let d = prepareRecording(src, rate)
  let note = null
  if (!inst.drum) {
    const near = inst.note ? frequency(noteNumber(inst.note)) : undefined
    const heard = detectPitch(d, RATE, near)
    const tuned = tuneRecording(d, near)
    d = tuned.data
    note = tuned.note === null ? inst.note : noteName(tuned.note)
    const off = 1200 * Math.log2(heard / frequency(noteNumber(note)))
    if (inst.note && note !== inst.note) console.warn(`  ${inst.name}: heard ${note}, expected ${inst.note}`)
    if (Math.abs(off) > 10) console.log(`  ${inst.name}: was ${off.toFixed(0)} cents off ${note}, tuned`)
  }
  const json = serializeInstrumentFile({ note: note === null ? null : noteNumber(note), volume: inst.volume })
  if (json) fs.writeFileSync(path.join(out, `${inst.name}.json`), json)
  else fs.rmSync(path.join(out, `${inst.name}.json`), { force: true })
  fs.writeFileSync(path.join(out, `${inst.name}.wav`), encodeWav(d))
  credits.push(`- **${inst.name}**${note ? ` (${note})` : ''}: ${inst.source}. ${inst.by}`)
  console.log(`${inst.name.padEnd(16)} ${(d.length / RATE).toFixed(2)} s  ${note ?? 'drum'}`)
}
fs.writeFileSync(path.join(out, 'SOURCES.md'), credits.join('\n') + '\n')

/** Where the sound starts: `cut` counts from there. */
function firstSound(d) {
  let peak = 0
  for (const v of d) peak = Math.max(peak, Math.abs(v))
  let i = 0
  while (i < d.length && Math.abs(d[i]) < peak * 0.05) i++
  return i
}
