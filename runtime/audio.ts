// The page's one audio context, shared by the editor's pages and the game: an iPad wants one.

let shared: AudioContext | null = null

/** The audio context, made on the first sound. A browser only lets it play after a click or a
 *  key: `audioContext()` resumes it, and so does any key or touch once one has been made. */
export function audioContext(): AudioContext {
  if (!shared) {
    try {
      // Plays even with an iPhone's or iPad's silent switch on (set once: singing switches
      // it to play-and-record for a while, editor/src/microphone.ts).
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
      if (session) session.type = 'playback'
    } catch {}
    shared = new AudioContext()
    // A game plays its sounds from its updates, never from a click: the first key or touch
    // lets them be heard (a game opened with ?play starts without one).
    for (const type of ['keydown', 'pointerdown', 'touchend']) window.addEventListener(type, wake, { capture: true })
  }
  wake()
  return shared
}

/** Not only "suspended": Safari also has "interrupted", which is where a change of audio
 *  session (singing) or another app taking the sound leaves it, silent until resumed. */
function wake() {
  if (shared && shared.state !== 'running' && shared.state !== 'closed') void shared.resume()
}
