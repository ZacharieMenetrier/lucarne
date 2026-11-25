// Renders more takes of the game's sounds off the game's thread (see sounds.ts): a long ring
// takes tens of milliseconds to make, which would stall the game if it were made between
// two frames.

import { renderSound, type Sound } from './sfx'

self.onmessage = (e: MessageEvent<{ name: string; sound: Sound; count: number }>) => {
  const { name, sound, count } = e.data
  for (let i = 0; i < count; i++) {
    const data = renderSound(sound)
    if (data) postMessage({ name, data }, { transfer: [data.buffer] })
  }
}
