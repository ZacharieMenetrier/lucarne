# Lucarne

A pixel art game engine where you draw, compose, code and play in one place.
See [the specification](./Lucarne%20—%20Cahier%20des%20charges.md).

For now: the **pixel art editor** (step 1, first delivery: drawing).

Every sprite of the game sits on one board, at the same scale, so you can check
that they look consistent and draw on any of them directly.

## Running the editor

```bash
npm install
npm run dev -- ../my-game   # opens the editor on a game folder (created if missing)
```

Games live in their own folders (and their own repos), never inside this one.
In a game folder: `npx lucarne dev` (or `node path/to/lucarne/bin/lucarne.mjs dev .`).
`--host` makes the editor reachable on the local network.

On macOS, Safari > File > Add to Dock on `localhost:5173` installs the editor as an app:
start `lucarne dev`, then open that app. The port stays 5173 (it never drifts to
another one), so the app always finds the server.

Without the local server (iPad, installed version), the editor saves to the browser's
private file system (OPFS). On Mac, add `?storage=opfs` to the URL to force that mode.
OPFS requires HTTPS or localhost: on iPad, use the built version (`npm run build`,
`dist/` folder) served over HTTPS.

## Syncing with GitHub (iPad)

In the menu (top left), **Settings** takes a GitHub token, the game's repository
(`owner/name`), a branch and, if the game is not at the root, its folder in the repository.
Use a fine-grained token limited to that repository, with **Contents: Read and write**.
The token stays in the browser, on that device only.

When the editor works from the browser's storage, a sync button shows in the top bar.
It compares `palette.json`, `board.json` and `sprites/*` on the device, on GitHub, and
as they were at the last sync: changes on one side follow that side, changes sent to
GitHub go out as one commit. A file (or sprite) changed on both sides is a conflict: the
editor asks which version to keep. On Mac with `lucarne dev`, use git in the game folder.

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
- `menu.ts`, `settings.ts`: the burger menu, pages, and the settings page
- `github.ts`: GitHub sync (REST API, three-way comparison), tested in `tests/sync.test.ts`

The local server (`server/fs-plugin.mjs`) only accepts paths inside the game folder,
excluding hidden files (`.git`…), and rejects requests coming from another site.

MIT license. Icons come from [Material Symbols](https://fonts.google.com/icons) (Google, Apache 2.0 license).
