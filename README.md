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
It compares `palette.json`, `board.json`, `sprites/*` and `fonts/*` on the device, on GitHub, and
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
  width: 320, height: 180,                   // the world on screen, in game pixels
  draw() { screen.clear('#1a1c2c') },        // the background, under the things
})
```

`width` and `height` are the game's resolution: every display shows exactly that much of
the world. The engine scales it up by the largest whole number that fits (×5 for
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

## Development

```bash
npm test             # tests (vitest)
npm run typecheck
npm run build        # installable static version, in dist/
```

The engine that games import (`import … from 'lucarne'`) lives in `runtime/`: the loop
(`runner.ts`), the world, its things and the camera (`world.ts`, smooth motion between
updates), `screen.ts`, `sprites.ts`, `fonts.ts`, the dialogue and menu (`ui.ts`),
`input.ts` and the clocks (`time.ts`). `game.js` holds only the game's code: the editor
provides the engine when it plays it (`server/build.mjs` explains how).

Editor code lives in `editor/src/`:

- `bitmap.ts`, `color.ts`: pixels and operations (line, fill, flip…)
- `sprite.ts`, `png.ts`: sprite format
- `font.ts`, `fontimport.ts`: font format, and importing a pixel font (tested in `tests/font.test.ts`)
- `storage.ts`, `project.ts`: reading and writing the game folder (local server or OPFS)
- `board.ts`: sprite positions (`board.json`) and automatic placement
- `editor.ts`: the board, tools, selection, history — no DOM, tested in `tests/`
- `view.ts`, `input.ts`: rendering, zoom, mouse, pen and gestures
- `app.ts`: interface, shortcuts, autosave
- `menu.ts`, `settings.ts`: the burger menu, pages, and the settings page
- `play.ts`: play mode (loads `game.js`, runs it, pause and stop, `?play` and `window.lucarne`)
- `github.ts`: GitHub sync (REST API, three-way comparison), tested in `tests/sync.test.ts`

The local server (`server/fs-plugin.mjs`) only accepts paths inside the game folder,
excluding hidden files (`.git`…), and rejects requests coming from another site.

MIT license. Icons come from [Material Symbols](https://fonts.google.com/icons) (Google, Apache 2.0 license).
