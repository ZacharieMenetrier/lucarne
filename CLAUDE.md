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
