# Lucarne

A pixel art game engine where you draw, compose, code and play in one place.
See [the specification](./Lucarne%20—%20Cahier%20des%20charges.md).

For now: the **pixel art editor** (step 1, first delivery: drawing).

Every sprite of the game sits on one board, at the same scale, so you can check
that they look consistent and draw on any of them directly.

## Running the editor

```bash
npm install
npm run dev          # opens the editor on examples/demo
```

In a game folder: `npx lucarne dev` (or `node path/to/lucarne/bin/lucarne.mjs dev .`).
`--host` makes the editor reachable on the local network.

Without the local server (iPad, installed version), the editor saves to the browser's
private file system (OPFS). On Mac, add `?storage=opfs` to the URL to force that mode.
OPFS requires HTTPS or localhost: on iPad, use the built version (`npm run build`,
`dist/` folder) served over HTTPS.

## Game files

```
my-game/
  palette.json       ["#1a1c2c", "#5d275d", …]
  board.json         where each sprite sits on the editor's board, and its color
  sprites/hero.png   sheet: one row per direction, one column per frame
  sprites/hero.json  { "version": 1, "frameWidth": 16, "frameHeight": 16,
                       "directions": [{ "name": "default" }], "frames": [{ "duration": 100 }] }
```

Every change is saved automatically, about 0.4 s after the last stroke.

## Controls

| Action | Keyboard / mouse | iPad |
| --- | --- | --- |
| Pencil, eraser, fill, eyedropper | B, E, G, I | toolbar |
| Line, rectangle, filled rectangle | L, R, ⇧R (⇧: snap angle or square) | toolbar |
| Select | M; drag inside to move, ⌥ + drag to copy | selection bar |
| Move a sprite on the board | V, or drag its name with any tool | same |
| Zoom in on a sprite | double-click its name (or the sprite, with V) | double tap |
| Palette colors 1 to 9 | 1 … 9 | |
| Undo / redo | ⌘Z / ⇧⌘Z | two- / three-finger tap |
| Copy, cut, paste, select all | ⌘C, ⌘X, ⌘V, ⌘A | selection bar |
| Flip | ⇧H, ⇧V (selection or whole image) | selection bar |
| Zoom | trackpad pinch, ⌥ + wheel, + / − | two-finger pinch |
| Pan | wheel, space + drag, middle button | two-finger drag |
| Show every sprite, grid | 0, # | top bar |
| Board color, saved with the game | swatch in the top bar | same |

With a pen, only the pen draws: fingers and the palm leave no marks.

## Development

```bash
npm test             # tests (vitest)
npm run typecheck
npm run build        # installable static version, in dist/
```

Editor code lives in `editor/src/`:

- `bitmap.ts`, `color.ts`: pixels and operations (line, fill, flip…)
- `sprite.ts`, `png.ts`: sprite format
- `storage.ts`, `project.ts`: reading and writing the game folder (local server or OPFS)
- `board.ts`: sprite positions (`board.json`) and automatic placement
- `editor.ts`: the board, tools, selection, history — no DOM, tested in `tests/`
- `view.ts`, `input.ts`: rendering, zoom, mouse, pen and gestures
- `app.ts`: interface, shortcuts, autosave

The local server (`server/fs-plugin.mjs`) only accepts paths inside the game folder,
excluding hidden files (`.git`…), and rejects requests coming from another site.

MIT license. Icons come from [Material Symbols](https://fonts.google.com/icons) (Google, Apache 2.0 license).
