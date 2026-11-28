# Lucarne

A pixel art game engine: an editor to draw, compose, code and play, and the runtime games
import (`runtime/`). The README documents the API, the file formats and the code layout.

## Convention over configuration

Lucarne is an opinionated engine about how a game is set up and run: its scaling, frame
rate, keys, file layout, where actors are found. These have one right behavior, and a game
never configures them. This is a requirement for every change.

- Before adding an option, a parameter, a flag or a setting, find the one right behavior
  and make it the only one. Decide; write why in a comment. If the right choice is unclear,
  ask the user rather than letting each game choose.
- When a setting really belongs to the game (its resolution), it gets one obvious default,
  so that leaving it out is the usual case.
- Files and folders have fixed names and places. The engine finds them; nothing points to
  them.
- When you notice an existing option that a convention could replace, propose removing it.

## The engine gives building blocks, the game writes itself

Conventions are for setup, not for what a game does. What a game does and how it looks is
its own code: its dialogue, menus, HUD and rules. Every game wants these differently, so the
engine never ships a ready-made version of them, with or without options, and offers no
presets to copy. It provides what a game cannot write itself, or what only works one way:
the loop, time, input, drawing, the store, waiting.

- Before adding something to the engine, ask whether a game could write it in its own code.
  If it could, and two games would want it differently, it is not the engine's.
- Engine code or game code, nothing in between: no defaults meant to be overridden, no
  templates copied into games.

## The code declares, the editor sets

An actor is `actors/<name>.ts` alone: its class, its behavior and each variable's default.
A map holds where each one starts and its own values. A value is the code's default, then
the map, then `spawn`'s values: the last set wins (`runtime/values.ts`). What is drawn
belongs to the art: a sprite's box is drawn on it (`sprites/<name>.json`), and an actor has
a box only when its code takes one (`box = sprite('hero').box`), never by its name.

- Anything the editor sets is data, never written into the code; anything the code declares
  gets its default there, never in a file. A new engine-level fact about actors becomes a
  field on `Actor` (like `box`), not a new file or setting.
- A default in the code may not be what the game uses: check the maps, or
  `lucarne.actors()`, before reasoning from it.
- Reuse goes through inheritance (`extends` another actor) and plain functions in `code/`.
  There are no components.

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
  `await lucarne.step(n, buttons)` runs n updates with those buttons held (exact, works with
  the page hidden), `lucarne.actors()` lists the actors and their state, `lucarne.ui()` the
  text on screen, `lucarne.scripts()` what each script waits on, `await lucarne.picture()`
  the frame at game resolution.
- The browser pane only follows `.claude/launch.json` of the session's working folder: from
  a game's folder, start the test editor with Bash, in the background.
