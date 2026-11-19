# Lucarne

A pixel art game engine: an editor to draw, compose, code and play, and the runtime games
import (`runtime/`). The README documents the API, the file formats and the code layout.

## Convention over configuration

Lucarne is an opinionated engine. It makes the choices so that games don't have to: a game
should get the right behavior by writing nothing. This is a requirement for every change.

- Before adding an option, a parameter, a flag or a setting, find the one right behavior
  and make it the only one. Decide; write why in a comment. If the right choice is unclear,
  ask the user rather than letting each game choose.
- A game declares what it is (its resolution, its sprites, its code), never how the engine
  works (scaling, frame rate, keys, file layout, where things are found).
- When a choice really belongs to the game, it gets one obvious default, so that leaving it
  out is the usual case.
- Files and folders have fixed names and places. The engine finds them; nothing points to
  them.
- When you notice an existing option that a convention could replace, propose removing it.

## Working with AI

Lucarne is developed AI first: an AI must be able to run, play and check everything itself.

- The user keeps `lucarne dev` running on port 5173 for their game, and uses it as a web app
  installed from Safari. Never start a server on 5173 and never stop theirs. If it is not
  running, ask the user.
- Editors don't sync with each other: an editor that is open next to the user's would
  overwrite their sprites and board with an older copy. So never edit a real game's sprites,
  palette or board in the browser (ask the user first if one must change).
- To test the editor itself (tools, interface), run a separate server on a throwaway game
  folder, which `lucarne dev` creates: the `test-editor` preview config, i.e.
  `npm run dev -- "$TMPDIR/lucarne-test-game" --port 5174`. That is why `--port` exists.
- Test editor logic with vitest first (`editor.ts` has no DOM). Use the browser only for what
  the interface shows.
- To check a game, play it at `localhost:5173/?play` (the game's own CLAUDE.md says how).
  Playing reads the game folder and writes nothing. In play mode, `window.lucarne` drives
  the game without the keyboard or screenshots (README: "Driving a game from a script"):
  `lucarne.step(n, buttons)` runs n updates with those buttons held (exact, works with the
  page hidden), `lucarne.things()` lists the things and their state, `lucarne.ui()` the
  text on screen, `await lucarne.picture()` the frame at game resolution.
- The browser pane only follows `.claude/launch.json` of the session's working folder: from
  a game's folder, start the test editor with Bash, in the background.
