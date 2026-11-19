# Lucarne

A pixel art game engine where you draw, compose, code and play in one place.

For now: the **pixel art editor** and the **world editor**.

Every sprite of the game sits on one board, at the same scale, so you can check
that they look consistent and draw on any of them directly. In the same way, every map of
the game sits in one world, at its place.

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
It compares `game.json`, `palette.json`, `board.json`, `sprites/*`, `tiles/*`, `maps/*` and
`fonts/*` on the device, on GitHub, and
as they were at the last sync: changes on one side follow that side, changes sent to
GitHub go out as one commit. A file (or sprite) changed on both sides is a conflict: the
editor asks which version to keep. On Mac with `lucarne dev`, use git in the game folder.

## Game files

```
my-game/
  game.json          { "width": 384, "height": 216, "tileSize": 16 }   // every one optional
  palette.json       ["#1a1c2c", "#5d275d", …]
  board.json         where each sprite sits on the editor's board, and its color
  sprites/hero.png   sheet: the animation frames side by side, left to right
  sprites/hero.json  { "version": 1, "frameWidth": 16, "frameHeight": 16,
                       "frames": [{ "duration": 100 }],
                       "origin": { "x": 8, "y": 15 } }   // optional, a pixel
  tiles/outdoor.png  a tileset: 8 tiles wide, whole rows of the tile size, no JSON
  maps/town.json     a map: its place in the world and its tiles (see "Maps")
  fonts/name.png     a font: its characters in white, in a grid (made by importing one)
  fonts/name.json    which character is in which cell, and how far the next one starts
  fonts/name.license.txt   the font's license, when it has one
  code/main.ts       the game's code (TypeScript), starting point
  game.js            built from code/ by `lucarne dev`: commit it, never edit it
```

Every change is saved automatically, about 0.4 s after the last stroke.

## Playing

▶ in the top bar (⌘↵) plays the game in the editor. Esc pauses and resumes, ■ goes back
to the editor. Arrows or WASD (ZQSD on AZERTY) move, Space or Enter is the action;
a gamepad works too. The play bar shows how long an update and a frame take: an update
has 16.7 ms.

A game is made of **things**: classes that extend `Thing`. Creating one puts it in the
world; the engine updates and draws every thing by itself.

```ts
// code/main.ts
import { Thing, camera, game, input, screen, sprite } from 'lucarne'

class Hero extends Thing {
  update() { this.move(input.x * 1.25, input.y * 1.25) }   // 60 times per second
  draw() { screen.sprite(sprite('hero'), 0, 0) }           // around itself
}

camera.follow(new Hero(160, 90))

export default game({
  draw() { screen.clear('#1a1c2c') },        // the background, under the maps and things
})
```

The game's code says what it does; `game.json` says what it is, and the editor writes it
(**Settings**, in the menu). `width` and `height` are the game's resolution (320 × 180
unless set): every display shows exactly that much of the world. The engine scales it up by the largest whole number that fits (×5 for
384 × 216 on a 1080p screen, ×10 on 4K) and fills the rest with black bars. The game never
chooses the scale, and never needs to know it.

### Things

- `update()` runs 60 times per second on every display, for every thing, in the order they
  were created. A thing created during an update gets its first update on the next one.
  There is no update for the game itself: what concerns the whole game (a clock, a
  spawner) is a thing too, one that draws nothing.
- `draw()` draws the thing **around itself**: (0, 0) is where it is, and a sprite drawn at
  (0, 0) puts its origin pixel there (set the origin between a character's feet). Things
  are drawn from the top of the world down, by `y`: the lower one is in front.
- `this.move(dx, dy)` moves; `this.place(x, y)` jumps there with no in-between (a door, a
  teleport); `this.remove()` takes the thing out of the world at the end of the update.
- `drawUI()` draws on the screen itself, over the world, where the camera does not move it.

Displays refresh at other rates (120 Hz, 144 Hz…), so on each displayed frame the engine
draws every thing between where it was before its last update and where it is now: motion
is smooth on any display, with no `dt` in the game's code. A thing just created or placed
is drawn where it is. On a 60 Hz display, each frame shows the last update as it is.
`draw` only draws: the screen cannot be used elsewhere, and the game should not change in it.

### Camera

`camera.x` and `camera.y` are the world position at the top left of the screen: (0, 0)
until the game moves the camera. `camera.follow(thing)` keeps a thing in the middle of the
screen; the camera moves after every thing has updated. Positions are rounded to display
pixels once, relative to the camera, so a followed thing stays perfectly still while the
world scrolls behind it.

### Sprites

Sprites are drawn by name. Their origin pixel lands on the position given, and their
animation plays by itself on the game's clock (`time.ms`):

```ts
screen.sprite(sprite('hero'), 0, 0)                      // animated
screen.sprite(sprite('hero'), 0, 0, { flipX: true })     // mirrored
screen.sprite(sprite('hero'), 0, 0, { frame: 0 })        // one frame
screen.panel(sprite('panel'), 8, 8, 120, 40)             // a box of any size
```

`screen.panel` draws a sprite at any size by stretching its middle row and middle column:
a window frame drawn once fits any text.

Positions are in game pixels and may have decimals. Things are drawn on the display's own
pixels: a whole number puts them on the game's pixel grid, a fraction places them between
its pixels, so a hero running at 1.5 pixels per update moves smoothly instead of stepping
2, 1, 2, 1. The art is never resampled: a sprite's pixels stay whole squares.

Before the game's code runs, the editor saves what is not saved yet and loads every sprite
and font of the game folder, so `sprite()` and `font()` work anywhere, even at the top of
a file.

### Maps

The whole game sits in one world. Each map (`maps/<name>.json`) has its place in it, and the
engine draws every map itself, under the things, from the tilesets in `tiles/`: there is
nothing to write in the code. A door to another map is `hero.place(x, y)`.

- `tileSize` (`game.json`, 16 unless set) is the size of a tile, for the whole game. It
  cannot change once a map or a tileset exists (64 at most).
- A tileset is always 8 tiles wide and grows only in rows. A narrower one (made elsewhere)
  gets empty columns on its right when the editor opens it.
- A map is never smaller than the screen, and maps never overlap (they may touch).
- The camera stays inside the map of the thing it follows, and stops at its edges. When
  that thing goes into another map, the camera snaps to it at once: the maps around the one
  shown never appear. Outside every map, the camera follows freely.

```json
{
  "version": 1,
  "x": 0, "y": 0, "width": 24, "height": 14,
  "tilesets": ["house", "outdoor"],
  "cells": [
    [1, 3, 1], [1, 3, 1], null, …
  ]
}
```

Positions and sizes are in tiles. A cell is `[tileset, column, row]`, the tileset by its
place in `tilesets` and the tile by its column and row in that tileset, so a tileset can
grow downward without moving the tiles maps use; `null` is empty.

### Text and UI

```ts
screen.text('Bonjour !', 8, 8, '#f4f4f4')                 // in the game's font
screen.text(long, 8, 8, '#f4f4f4', { width: 120 })        // wrapped at 120 pixels
font().measure('Bonjour !')                               // { width, height }

new Dialogue(['Hello!', 'Nice weather today.'])           // letter by letter, page by page
new Menu(['Yes', 'No'], (i) => { … })                     // up, down, action
```

Text is stamped from the font's own pixels: the browser never draws it, so it is as crisp
as the sprites, on every device. There is no font in the engine: a game that writes brings
its own, in `fonts/`. The menu has **Import a font…**: choose a pixel font file (.ttf,
.otf, .woff) together with its license file. It is read once, at the size it is drawn for
(its page says: often 8, 12 or 16), pixel by pixel. With one font in
`fonts/`, `font()` and `screen.text` use it; with several, name one: `font('small')`.

Some pixel fonts that work well, and what their license asks:

- [m5x7](https://managore.itch.io/m5x7) by Daniel Linssen: CC0, nothing asked (small,
  accents included).
- [BoldPixels](https://yukipixels.itch.io/boldpixels) by YukiPixels: CC BY-SA 4.0, credit
  the author with the game.

A thing whose `modal` is true (a menu, a dialogue) stops the world while it is there: only
the last modal thing created updates, the camera and the world's clock (`time.ms`) stop,
and everything is still drawn behind it. The UI's clock (`time.uiMs`) keeps running, so
text still appears and cursors still blink. `Dialogue` and `Menu` are modal, and remove
themselves when done. They draw their box with the game's sprite named `panel` if it has
one, and the menu's cursor with `cursor`. Extend them to change their text color:
`class Sign extends Dialogue { color = '#1a1c2c' }`.

### Driving a game from a script

`?play` at the end of the editor's address opens straight into the game. In play mode,
`window.lucarne` drives it, one update at a time, the same way every time, even with the
page hidden (what an AI uses to test a game):

```js
lucarne.step(60, ['right'])   // 60 updates with "right" held, then shows the result
lucarne.things()              // [{ type: 'Hero', x: 267, y: 120, facing: 'east', … }]
lucarne.ui()                  // { modal: 'Menu', text: ['Yes', 'No', '>'] }
lucarne.camera()              // { x: 96, y: 0, map: 'town' }
await lucarne.picture()       // the frame at game resolution, as a PNG data URL
lucarne.timings()             // milliseconds per update, per drawing, per frame
```

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

**Tilesets** have their own panel under the sprites. They sit on the board and are drawn
like sprites, with their tile grid shown; they are 8 tiles wide, add or remove rows from a
corner, and have no animation.

The **world editor** (menu, top left) shows every map at its place. Zoom, pan and undo work
as on the board. Its side panel shows one tileset at a time, at the panel's width, above the
list of maps; the list next to "Tilesets" switches to another one.

| Action | Keyboard / mouse |
| --- | --- |
| Stamp the tiles picked in a tileset panel (drag over several to pick a block) | B |
| Eraser, eyedropper (picks the tile under it) | E, I |
| Move a map (drag it), resize it from any corner | V |
| Show every map | 0 |
| Back to the board | Esc |

**+** next to Maps makes a map one screen big, in free space. Maps snap to whole tiles,
stop against each other, and never get smaller than one screen.

## Development

```bash
npm test             # tests (vitest)
npm run typecheck
npm run build        # installable static version, in dist/
```

The engine that games import (`import … from 'lucarne'`) lives in `runtime/`: the loop
(`runner.ts`), the world, its things and the camera (`world.ts`, smooth motion between
updates), the maps and the camera's limits (`maps.ts`), `screen.ts`, `sprites.ts`,
`fonts.ts`, the dialogue and menu (`ui.ts`), `input.ts`, the clocks (`time.ts`), and the
game's settings (`game.ts`, read from `game.json`). `game.js` holds only the game's code: the editor
provides the engine when it plays it (`server/build.mjs` explains how).

Editor code lives in `editor/src/`:

- `bitmap.ts`, `color.ts`: pixels and operations (line, fill, flip…)
- `sprite.ts`, `png.ts`: sprite format, and tilesets (`tiles/<name>` on the board)
- `map.ts`: map format (tested in `tests/world.test.ts`)
- `font.ts`, `fontimport.ts`: font format, and importing a pixel font (tested in `tests/font.test.ts`)
- `storage.ts`, `project.ts`: reading and writing the game folder (local server or OPFS)
- `board.ts`: sprite positions (`board.json`), automatic placement, resizing by a corner
- `editor.ts`: the board, tools, selection, history — no DOM, tested in `tests/`
- `viewport.ts`, `view.ts`, `input.ts`: zoom and panning, rendering the board, mouse, pen and gestures
- `world.ts`: the world editor's maps, tools, history — no DOM, tested in `tests/world.test.ts`
- `worldview.ts`, `worldpage.ts`: rendering the world, and its page
- `app.ts`: interface, shortcuts, autosave
- `menu.ts`, `settings.ts`: the burger menu, pages, and the settings page (`game.json`, GitHub)
- `play.ts`: play mode (loads `game.js`, runs it, pause and stop, `?play` and `window.lucarne`)
- `github.ts`: GitHub sync (REST API, three-way comparison), tested in `tests/sync.test.ts`

The local server (`server/fs-plugin.mjs`) only accepts paths inside the game folder,
excluding hidden files (`.git`…), and rejects requests coming from another site.

MIT license. Icons come from [Material Symbols](https://fonts.google.com/icons) (Google, Apache 2.0 license).
