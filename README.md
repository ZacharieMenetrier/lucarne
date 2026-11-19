# Lucarne

A pixel art game engine where you draw, compose, code and play in one place.

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
  sprites/hero.png   sheet: the animation frames side by side, left to right
  sprites/hero.json  { "version": 1, "frameWidth": 16, "frameHeight": 16,
                       "frames": [{ "duration": 100 }],
                       "origin": { "x": 8, "y": 15 } }   // optional, a pixel
  code/main.ts       the game's code (TypeScript), starting point
  game.js            built from code/ by `lucarne dev`: commit it, never edit it
```

Every change is saved automatically, about 0.4 s after the last stroke.

## Playing

▶ in the top bar (⌘↵) plays the game in the editor. Esc pauses and resumes, ■ goes back
to the editor. Arrows or WASD (ZQSD on AZERTY) move, Space or Enter is the action;
a gamepad works too.

```ts
// code/main.ts
import { game, input, screen } from 'lucarne'

let x = 156
export default game({
  width: 320, height: 180,                // the world on screen, in game pixels
  update() { x += input.x * 2 },          // 60 times per second
  draw() { screen.clear('#1a1c2c'); screen.rect(x, 86, 8, 8, '#ffcd75') },
})
```

`width` and `height` are the game's resolution: every display shows exactly that much of
the world. The engine scales it up by the largest whole number that fits (×5 for
384 × 216 on a 1080p screen, ×10 on 4K) and fills the rest with black bars. The game never
chooses the scale, and never needs to know it.

Positions are in game pixels and may have decimals. Things are drawn on the display's own
pixels: a whole number puts them on the game's pixel grid, a fraction places them between
its pixels, so a hero running at 1.5 pixels per update moves smoothly instead of stepping
2, 1, 2, 1. The art is never resampled: a sprite's pixels stay whole squares. Keep what
must line up with the world's grid (ground, walls) on whole numbers.

`update` runs 60 times per second on every display, and `draw` after each update. Displays
refresh at other rates (120 Hz, 144 Hz…), so the engine records what `draw` draws and, on
each displayed frame, shows what moved between its last two positions: motion is smooth on
any display, with no `dt` in the game's code. Things are recognized by what they look like
and where they are; one that moved more than 8 pixels in an update jumped (a teleport, a new
room) and is shown where it is. `draw` only draws: the screen cannot be used elsewhere, and
the game should not change in it.

Sprites are drawn by name. Their origin pixel lands on the position given, and their
animation plays by itself on the game's clock (`time.ms`, which stops while paused):

```ts
import { game, screen, sprite } from 'lucarne'

export default game({
  draw() {
    screen.clear('#1a1c2c')
    screen.sprite(sprite('hero'), 160, 90)                    // animated
    screen.sprite(sprite('hero'), 200, 90, { flipX: true })   // mirrored
    screen.sprite(sprite('hero'), 240, 90, { frame: 0 })      // one frame
  },
})
```

Before the game's code runs, the editor saves what is not saved yet and loads every sprite
of the game folder, so `sprite()` works anywhere, even at the top of a file.

If the game has no code yet, ▶ shows a little night scene instead (the arrows and the
action key do something there too).

The browser cannot run TypeScript, so `lucarne dev` builds `code/` into `game.js` whenever
a file in it changes, and again just before playing. Build errors show in the editor and
in the terminal. The iPad has no server: it plays the `game.js` it gets from GitHub,
with the sprites as they are on the iPad. Code is written on the Mac; sprites can be
changed on either.

## Controls

| Action | Keyboard / mouse | iPad |
| --- | --- | --- |
| Pencil, eraser, fill, eyedropper | B, E, G, I | toolbar |
| Line, rectangle, filled rectangle | L, R, ⇧R (⇧: snap angle or square) | toolbar |
| Origin: click a pixel (click it again to clear) | O | toolbar |
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

The engine that games import (`import … from 'lucarne'`) lives in `runtime/`: the loop
(`runner.ts`), `screen.ts`, `interpolate.ts` (smooth motion between updates), `input.ts`,
`sprites.ts` and the clock (`time.ts`). `game.js` holds only the game's code: the editor
provides the engine when it plays it (`server/build.mjs` explains how).

Editor code lives in `editor/src/`:

- `bitmap.ts`, `color.ts`: pixels and operations (line, fill, flip…)
- `sprite.ts`, `png.ts`: sprite format
- `storage.ts`, `project.ts`: reading and writing the game folder (local server or OPFS)
- `board.ts`: sprite positions (`board.json`) and automatic placement
- `editor.ts`: the board, tools, selection, history — no DOM, tested in `tests/`
- `view.ts`, `input.ts`: rendering, zoom, mouse, pen and gestures
- `app.ts`: interface, shortcuts, autosave
- `menu.ts`, `settings.ts`: the burger menu, pages, and the settings page
- `play.ts`: play mode (loads `game.js`, runs it, pause and stop)
- `github.ts`: GitHub sync (REST API, three-way comparison), tested in `tests/sync.test.ts`

The local server (`server/fs-plugin.mjs`) only accepts paths inside the game folder,
excluding hidden files (`.git`…), and rejects requests coming from another site.

MIT license. Icons come from [Material Symbols](https://fonts.google.com/icons) (Google, Apache 2.0 license).
