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
  game.json          { "columns": 20, "rows": 11, "tileSize": 16 }   // every one optional
  palette.json       ["#1a1c2c", "#5d275d", …]
  board.json         where each sprite sits on the editor's board, and its color
  actors.json        each class of actors' box, by class name (see "Walls"), only when one has a box
  sprites/hero.png   sheet: the animation frames side by side, left to right
  sprites/hero.json  { "version": 1, "frameWidth": 16, "frameHeight": 16,
                       "frames": [{ "duration": 100 }],
                       "origin": { "x": 8, "y": 15 } }   // optional, a pixel
  tiles/outdoor.png  a tileset: 8 tiles wide, whole rows of the tile size
  tiles/outdoor.json its solid tiles (see "Walls"), only when it has some
  maps/town.json     a map: its place in the world and its tiles (see "Maps")
  fonts/name.png     a font: its characters in white, in a grid (made by importing one)
  fonts/name.json    which character is in which cell, and how far the next one starts
  fonts/name.license.txt   the font's license, when it has one
  code/main.ts       the game's code (TypeScript), starting point
  game.js            built from code/ by `lucarne dev`: commit it, never edit it
```

Every change is saved automatically, about 0.4 s after the last stroke.

## Playing

**Play**, at the right of the top bar (⌘↵), plays the game in the editor. Esc pauses and resumes, ■ goes back
to the editor. Arrows or WASD (ZQSD on AZERTY) move, Space or Enter is the action;
a gamepad works too. The play bar shows how long an update and a frame take: an update
has 16.7 ms.

A game is made of **actors**: classes that extend `Actor`. Creating one puts it in the
world; the engine updates and draws every actor by itself.

```ts
// code/main.ts
import { Actor, camera, game, input, screen, sprite } from 'lucarne'

class Hero extends Actor {
  update() { this.move(input.x * 1.25, input.y * 1.25) }   // 60 times per second
  draw() { screen.sprite(sprite('hero'), 0, 0) }           // around itself
}

camera.follow(new Hero(160, 90))

export default game({
  draw() { screen.clear('#1a1c2c') },        // the background, under the maps and actors
})
```

The game's code says what it does; `game.json` says what it is, and the editor writes it
(**Settings**, in the menu). `columns` and `rows` are the screen, in tiles (20 × 11 unless
set): with 16-pixel tiles, the game's resolution is 320 × 176. Counted in tiles, the screen
always holds whole tiles, so the smallest map is exactly one screen. Every display shows
exactly that much of the world: the engine scales it up by the largest whole number that
fits (×6 for 320 × 176 on a 1080p screen, ×12 on 4K) and fills the rest with black bars.
The game never chooses the scale, and never needs to know it (`screen.width` and
`screen.height` give the resolution in game pixels). An older `game.json` with `width` and
`height` in pixels still works: the screen becomes the whole tiles that fit in it.

### Actors

- `update()` runs 60 times per second on every display, for every actor, in the order they
  were created. An actor created during an update gets its first update on the next one.
  There is no update for the game itself: what concerns the whole game (a clock, a
  spawner) is an actor too, one that draws nothing.
- `draw()` draws the actor **around itself**: (0, 0) is where it is, and a sprite drawn at
  (0, 0) puts its origin pixel there (set the origin between a character's feet). Actors
  are drawn from the top of the world down, by `y`: the lower one is in front.
- `this.move(dx, dy)` moves; `this.place(x, y)` jumps there with no in-between (a door, a
  teleport); `this.remove()` takes the actor out of the world at the end of the update.
- An actor's box is drawn on the **Actors** page, not written in the code (see "Walls").
  Walls and the other actors' boxes stop it; without one, it goes through everything.
- `drawUI()` draws on the screen itself, over the world, where the camera does not move it.

Displays refresh at other rates (120 Hz, 144 Hz…), so on each displayed frame the engine
draws every actor between where it was before its last update and where it is now: motion
is smooth on any display, with no `dt` in the game's code. An actor just created or placed
is drawn where it is. On a 60 Hz display, each frame shows the last update as it is.
`draw` only draws: the screen cannot be used elsewhere, and the game should not change in it.

### Camera

`camera.x` and `camera.y` are the world position at the top left of the screen: (0, 0)
until the game moves the camera. `camera.follow(actor)` keeps an actor in the middle of the
screen; the camera moves after every actor has updated. Positions are rounded to display
pixels once, relative to the camera, so a followed actor stays perfectly still while the
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

Positions are in game pixels and may have decimals. Actors are drawn on the display's own
pixels: a whole number puts them on the game's pixel grid, a fraction places them between
its pixels, so a hero running at 1.5 pixels per update moves smoothly instead of stepping
2, 1, 2, 1. The art is never resampled: a sprite's pixels stay whole squares.

Before the game's code runs, the editor saves what is not saved yet and loads every sprite
and font of the game folder, so `sprite()` and `font()` work anywhere, even at the top of
a file.

### Maps

The whole game sits in one world. Each map (`maps/<name>.json`) has its place in it, and the
engine draws every map itself, under the actors, from the tilesets in `tiles/`: there is
nothing to write in the code. A door to another map is `hero.place(x, y)`.

- `tileSize` (`game.json`, 16 unless set) is the size of a tile, for the whole game. It
  cannot change once a map or a tileset exists (64 at most).
- A tileset is always 8 tiles wide and grows only in rows. A narrower one (made elsewhere)
  gets empty columns on its right when the editor opens it.
- A map is never smaller than the screen (its `columns` × `rows`), and maps never overlap
  (they may touch).
- `map('town')` says where a map is, in game pixels: `{ name, x, y, width, height }`
  (to start the hero in it, or keep it inside). `mapAt(x, y)` gives the map under a point,
  or null between maps.
- The camera stays inside the map of the actor it follows, and stops at its edges. When
  that actor goes into another map, the camera snaps to it at once: the maps around the one
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

### The world page

The world page shows the whole world, every map at its place. It works in one of three
modes, chosen with the switch on top of its tools (or 1, 2, 3). The mode sets both the
tools on the left and the panel on the right, and only what it is about reacts to the
pointer: painting under a villager never grabs it. The page remembers the mode it was in.

- **Maps**: Move (V) moves a map and resizes it by its corners; the panel lists the maps,
  to create, rename, delete or go to one.
- **Tiles**: the pencil (B), eraser (E) and eyedropper (I), and the tilesets to pick tiles
  from. Actors fade a little, out of the way.
- **Actors**: Select (V) and Place (P), and the game's actors to place (see below).

### Placing actors on maps

The code says what an actor is; the map says where each one starts. Every class that
`code/main.ts` exports and that extends `Actor` can be placed on the maps, in the
**Actors** mode of the world page:

```ts
export class Villager extends Actor {
  update() { … }                                         // walks, talks: like any actor
  draw() { screen.sprite(sprite('villager'), 0, 0) }
}
```

- The Actors panel lists those classes, each drawn by its own `draw()`: the editor runs the
  game's code, creates one of each at (0, 0) and draws it, without ever updating it. What
  it shows is the game's first frame. It reads the code again when the world page opens
  and when the window comes back to the front. An actor that draws nothing (a spawner) shows
  as a dashed frame; one whose class the code no longer exports, as a red one. Modal actors
  (a `Dialogue`, a `Menu`) are UI and are not listed.
- The panel has one row per class, with a search field to filter them by name. The number
  at the right of a row says how many are placed; a click on it selects them all.
- Picking a row switches to Place: each click drops one, the pointer holding it by the
  middle of its sprite. Esc goes back to Select.
- Actors snap to half tiles by their **sprite's frame**: the frame's top left goes on a
  half tile, and the feet follow wherever they are in it. Draw a character in a 16 × 16
  sprite where it should stand in its cell, and it fills a cell exactly (or stands between
  two), whatever its origin or its box. An actor drawn with several sprites snaps by its
  largest one, its body. One that draws no sprite has its feet on half tiles. The magnet
  at the bottom left of the map (in Actors mode) turns snapping off: actors then go
  anywhere, by the pixel. This browser remembers it.
- Select: a click selects an actor, Shift adds or removes one, and dragging on the ground
  draws a box that selects what it touches (⌘A: every actor). Dragging the selection moves
  it, into another map too, the actor held snapping and the others following; the arrows
  nudge it by half a tile (a pixel with snapping off; Shift: a whole tile).
  ⌘C, ⌘X and ⌘V copy, cut and paste (at the pointer, or beside the copied actors), ⌘D
  duplicates, Delete removes. Undo covers it all.
- When the game starts, the engine creates every placed actor with `new Villager(x, y)`,
  map by map (by name), after the actors the code creates at its top level and before
  `start()`. From then on it is an actor like any other: it moves however its `update()`
  says, from map to map if it walks there. The map only holds where it starts.
- A map that places a class the code does not export stops the game with an error naming
  the map and the class.

In the map file, an actor is its class's export name and its feet, in game pixels from the
map's top left corner, so actors move with their map (and the ones left outside when a map
shrinks go):

```json
  "actors": [
    { "type": "Villager", "x": 40, "y": 96 }
  ]
```

### Walls

An actor with a box slides along walls and other actors by itself: there is nothing to
write in the code.

```ts
export class Hero extends Actor {
  update() { this.move(input.x * 1.25, input.y * 1.25) }
}
```

- The box is drawn on the **Actors** page (between Pixels and World in the switch): pick the
  class in the list, and drag over the actor, drawn large by its own `draw()` with its feet
  marked by a cross. The box is a rectangle around the feet (the actor's position, its
  sprite's origin), the same on every frame of the animation (one that changed would push
  the actor into walls). Feet a bit narrower than the sprite and a few pixels high suit a
  top-down game: the head can pass in front of a wall. Delete removes it, ⌘Z undoes, ↑ ↓
  go through the classes.
- Boxes are saved in `actors.json` by the name the class is exported under, like maps place
  it: only exported classes can have one. A class with no box of its own takes its
  parent's. `this.box` reads it, `{ x, y, width, height }`, (x, y) its top left relative to
  the feet.
- **Every box is solid to every other**: actors stop against each other as against walls.
  An actor that should be walked through (a coin, a trigger) has no box.
- The walls are the **solid tiles**, and everything **outside the maps**: the camera never
  leaves the maps, so nothing that collides does either. Two maps that touch are open to
  each other. A game with no maps has no walls.
- A tile's solid part is one rectangle inside it: the whole tile, its bottom half, a post
  in its middle… It is set in the tileset, with the Walls tool (X): a click makes a tile
  solid on its whole area (or not solid again), a drag draws its rectangle. Every map
  using that tile then has the wall.
- `move(dx, dy)` goes along x, then along y, each stopping at the first wall on its way: an
  actor pushed into a wall diagonally slides along it. The way is swept, so no speed goes
  through a wall, however thin. It returns `true` when the actor went the whole way and
  `false` when a wall stopped it (an enemy turns around).
- An actor that runs into the corner of a wall by at most half its box (across its way) is
  nudged around it, at its own speed, instead of stopping dead: walking into a corridor one
  tile wide does not need lining up to the pixel.
- `place(x, y)` ignores walls, and an actor placed inside one (or inside another actor) can
  always walk out of it.

```json
{
  "version": 1,
  "actors": {
    "Hero": { "box": { "x": -5, "y": -6, "width": 10, "height": 6 } }
  }
}
```

```json
{
  "version": 1,
  "solid": [
    { "column": 0, "row": 2, "x": 0, "y": 0, "width": 16, "height": 16 },
    { "column": 3, "row": 2, "x": 0, "y": 8, "width": 16, "height": 8 }
  ]
}
```

`actors.json` holds one line per class, sorted by name. `tiles/<name>.json` lists the solid tiles by column and row, like the cells of a map, with
their rectangle in pixels inside the tile. It exists only when some tile is solid.

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

An actor whose `modal` is true (a menu, a dialogue) stops the world while it is there: only
the last modal actor created updates, the camera and the world's clock (`time.ms`) stop,
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
lucarne.actors()              // [{ type: 'Hero', x: 267, y: 120, box: { x: 262, y: 114, width: 10, height: 6 }, … }]
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
| Box, on a tileset: click a tile to make it solid or not, drag to draw its solid part | X | toolbar |
| Select | M; drag inside to move, ⌥ + drag to copy | selection bar |
| Move a sprite on the board | V, or drag its name with any tool | same |
| Zoom in on a sprite | double-click its name (or the sprite, with V) | double tap |
| Palette colors 1 to 9 | 1 … 9 | |
| Undo / redo | ⌘Z / ⇧⌘Z | two- / three-finger tap |
| Copy, cut, paste, select all | ⌘C, ⌘X, ⌘V, ⌘A | selection bar |
| Flip | ⇧H, ⇧V (selection or whole image) | selection bar |
| Zoom | trackpad pinch, ⌥ + wheel, + / − | two-finger pinch |
| Pan | wheel, space + drag, middle button | two-finger drag |
| Show every sprite, grid, checkerboard | 0, # | buttons at the bottom left of the canvas |
| Board color, saved with the game | swatch at the bottom left of the canvas | same |

With a pen, only the pen draws: fingers and the palm leave no marks.

**Tilesets** have their own panel under the sprites. They sit on the board and are drawn
like sprites, with their tile grid shown; they are 8 tiles wide, add or remove rows from a
corner, and have no animation. With the Walls tool, their solid tiles show hatched in red. The Origin (O) and Walls (X) tools sit below a divider, after the drawing tools: each works on one kind of image only, and is greyed out on the other (a click says why).

The switch at the left of the top bar goes between the three editors, in the order a game
is made: **Pixels** (sprites and tilesets), **Actors** (each class's box, see "Walls") and
**World**.

The **world editor** (World, in the switch at the left of the top bar) shows every map at its place. Zoom, pan and undo work
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
(`runner.ts`), the world, its actors and the camera (`world.ts`, smooth motion between
updates, actors' boxes), walls (`collision.ts`), the maps and the camera's limits (`maps.ts`), `screen.ts`, `sprites.ts`,
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
- `actors.ts`: actors' boxes (`actors.json`) and their history — no DOM, tested in `tests/actors.test.ts`
- `actortypes.ts`, `actorspage.ts`: the game's classes of actors, drawn by their own code, and the Actors page
- `app.ts`: interface, shortcuts, autosave
- `menu.ts`, `settings.ts`: the burger menu, pages, and the settings page (`game.json`, GitHub)
- `play.ts`: play mode (loads `game.js`, runs it, pause and stop, `?play` and `window.lucarne`)
- `github.ts`: GitHub sync (REST API, three-way comparison), tested in `tests/sync.test.ts`

The local server (`server/fs-plugin.mjs`) only accepts paths inside the game folder,
excluding hidden files (`.git`…), and rejects requests coming from another site.

MIT license. Icons come from [Material Symbols](https://fonts.google.com/icons) (Google, Apache 2.0 license).
