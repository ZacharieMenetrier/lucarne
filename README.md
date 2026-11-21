# Lucarne

A pixel art game engine where you draw, compose, code and play in one place.

For now: the **pixel art editor**, the **world editor** and the **music editor**.

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
It compares `game.json`, `palette.json`, `board.json`, `sprites/*`, `tiles/*`, `maps/*`,
`actors/*.json`, `fonts/*`, `instruments/*` and `songs/*` on the device, on GitHub, and
as they were at the last sync: changes on one side follow that side, changes sent to
GitHub go out as one commit. A file (or sprite) changed on both sides is a conflict: the
editor asks which version to keep. On Mac with `lucarne dev`, use git in the game folder.

## Game files

```
my-game/
  game.json          { "columns": 20, "rows": 11, "tileSize": 16 }   // every one optional
  palette.json       ["#1a1c2c", "#5d275d", …]
  board.json         where each sprite sits on the editor's board, and its color
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
  actors/hero.ts     an actor: its code (TypeScript), a class that extends Actor (see "Actors")
  actors/hero.json   its values set in the editor, its box among them, only when it has some
  instruments/lute.wav   an instrument of the game's own: one note, as it plays (16 kHz, 8-bit)
  instruments/lute.json  { "note": "C4" }, the note it was recorded at; none: a drum
  songs/town.json    a song: its tempo and its tracks of notes (see "Music")
  code/main.ts       the rest of the game's code, optional: the game itself, helpers
  game.js            built from actors/ and code/ by `lucarne dev`: commit it, never edit it
```

Every change is saved automatically, about 0.4 s after the last stroke.

## Playing

**Play**, at the right of the top bar (⌘↵), plays the game in the editor. Esc pauses and resumes, ■ goes back
to the editor. Arrows or WASD (ZQSD on AZERTY) move, Space or Enter is the action;
a gamepad works too. The play bar shows how long an update and a frame take: an update
has 16.7 ms.

A game is made of **actors**: one file each in `actors/`, a class that extends `Actor`.
The engine creates them, updates and draws them by itself.

```ts
// actors/hero.ts
import { Actor, camera, input, screen, sprite } from 'lucarne'

export default class Hero extends Actor {
  speed = 1.25                                    // a variable: set in the editor too
  create() { camera.follow(this) }                // once, when its values are set
  update() { this.move(input.x * this.speed, input.y * this.speed) }   // 60 times per second
  draw() { screen.sprite(sprite('hero'), 0, 0) }  // around itself
}
```

```ts
// code/main.ts (optional)
import { game, screen } from 'lucarne'

export default game({
  draw() { screen.clear('#1a1c2c') },             // the background, under the maps and actors
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

An actor is a pair of files named alike: `actors/<name>.ts` is its code, a class that
extends `Actor` as the default export; `actors/<name>.json` holds what the editor sets for
every actor of that kind. The name is the file's (lowercase, `-` and `_`): maps place an
actor by it. A class in `code/` (a helper, a dialogue) is an actor that is never placed.

- Actors are created with `spawn(Hero, { x: 160, y: 90 })`, or placed on a map; never with
  `new`, which throws. `spawn` sets the actor's values (below), then calls its `create()`:
  what a constructor would do goes there. It returns the actor.
- `update()` runs 60 times per second on every display, for every actor, in the order they
  were created. An actor created during an update gets its first update on the next one.
  There is no update for the game itself: what concerns the whole game (a clock, a
  spawner) is an actor too, one that draws nothing.
- `draw()` draws the actor **around itself**: (0, 0) is where it is, and a sprite drawn at
  (0, 0) puts its origin pixel there (set the origin between a character's feet). Actors
  are drawn from the top of the world down, by `y`: the lower one is in front.
- `this.move(dx, dy)` moves; `this.place(x, y)` jumps there with no in-between (a door, a
  teleport); `this.remove()` takes the actor out of the world at the end of the update.
- An actor's box is drawn on the **Actors** page (see "Walls"). Walls and the other actors'
  boxes stop it; without one, it goes through everything.
- `drawUI()` draws on the screen itself, over the world, where the camera does not move it.

Displays refresh at other rates (120 Hz, 144 Hz…), so on each displayed frame the engine
draws every actor between where it was before its last update and where it is now: motion
is smooth on any display, with no `dt` in the game's code. An actor just created or placed
is drawn where it is. On a 60 Hz display, each frame shows the last update as it is.
`draw` only draws: the screen cannot be used elsewhere, and the game should not change in it.

### Variables: the code declares, the editor sets

A field of an actor whose default is a number, text, `true`/`false` or a list of lines of
text (`lines = ['Hello!']`) is a **variable**: the editor shows it, to set its value. Other
fields (objects, an empty list, `#private` ones) are the code's own. The box is the
engine's variable, on every actor (`null` unless set), typed or drawn on the actor.

A variable's value is looked up in this order, the last one set winning:

```
the code's default  →  each parent's actors/<parent>.json  →  actors/<name>.json  →  the placed actor (map)  →  spawn's values
```

- **Actors** page: the values for every actor of a kind, in `actors/<name>.json`. A value
  set there has its name in bold, with ↺ next to it to clear it; the name's tooltip says
  where an inherited one comes from. A click on a row selects it, the one worked on.
- **World** page: the values of the actors selected, for them alone, in the map.
- `spawn(Hero, { speed: 2 })`: values from the code, for that one.

A value in the code is only the default: an AI or a reader checks the actor's file and the
map before trusting it, or reads the actor as it runs (`lucarne.actors()`). A class that
extends another actor (`export default class Guard extends Villager`) takes its parent's
file before its own. A value a file sets that the code does not declare, or of the wrong
kind, stops the game with an error naming the file and the variable; the editor shows it
in red, to fix or remove.

```json
{
  "box": { "x": -5, "y": -6, "width": 10, "height": 6 },
  "lines": ["Hello!", "Nice weather today."],
  "speed": 0.5
}
```

An actor file holds only what is set, one value per line, the box first: none set, no file.

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

The world page shows the whole world, every map at its place. It works in one of two
modes, chosen with the switch on top of its tools (or 1, 2). The mode sets both the tools
on the left and the panel on the right, and only what it is about reacts to the pointer:
painting under a villager never grabs it. The page remembers the mode it was in.

- **Maps** arranges the world: the maps and the actors on them. Its panel reads from the
  top down: the game's actors, to place; the maps, each with its actors listed under it
  (▾ folds them), to create, rename, delete or select one; and what is selected. Each tool
  does one thing on the maps: Select (V) takes actors, Place (P) drops them, the Eraser
  (E) removes them, and **Move map** (M) moves a map and resizes it by its corners, so a
  map is never dragged by accident. A click on a row of the list selects that map or actor
  whatever the tool, and an actor that draws nothing (a spawner) is found there. A map
  selected shows its name, to rename it, and its size; Delete deletes it (asked first).
- **Tiles**: the pencil (B), eraser (E) and eyedropper (I), and the tilesets to pick tiles
  from. Actors fade a little, out of the way.

### Placing actors on maps

`actors/villager.ts` says what a villager is; the map says where each one starts, and what
this one does differently. Every actor file can be placed on the maps, in the **Maps**
mode of the world page.

- The Actors panel lists the actors, each drawn by its own `draw()`: the editor runs the
  game's code, creates one of each outside the world, with its values, and draws it,
  without ever updating it. What it shows is the game's first frame. It reads the code
  again when the page opens and when the window comes back to the front. An actor that
  draws nothing (a spawner) shows as a dashed frame; one with no `actors/<name>.ts`, as a
  red one.
- The panel has one row per actor, with a search field to filter them by name. The number
  at the right of a row says how many are placed; a click on it selects them all.
- At the bottom, the panel shows the variables of the actors selected, to set for them
  alone (several of the same kind at once; a value they do not share shows as `—`). ↺
  clears a value: the actor takes its file's again.
- Picking a row switches to Place: each click drops one, the pointer holding it by the
  middle of its sprite. Esc goes back to Select.
- Actors snap to half tiles by their **sprite's frame**: the frame's top left goes on a
  half tile, and the feet follow wherever they are in it. Draw a character in a 16 × 16
  sprite where it should stand in its cell, and it fills a cell exactly (or stands between
  two), whatever its origin or its box. An actor drawn with several sprites snaps by its
  largest one, its body. One that draws no sprite has its feet on half tiles. The magnet
  at the bottom left of the map (in Maps mode) turns snapping off: actors then go
  anywhere, by the pixel. This browser remembers it.
- Select: a click selects an actor, Shift adds or removes one, and dragging on the ground
  draws a box that selects what it touches (⌘A: every actor). Dragging the selection moves
  it, into another map too, the actor held snapping and the others following; the arrows
  nudge it by half a tile (a pixel with snapping off; Shift: a whole tile).
  ⌘C, ⌘X and ⌘V copy, cut and paste (at the pointer, or beside the copied actors), ⌘D
  duplicates, Delete removes. Undo covers it all.
- Eraser (E): a click removes the actor under the pointer, and a stroke every actor it
  crosses; one undo brings the whole stroke back. Esc goes back to Select.
- When the game starts, the engine spawns every placed actor, map by map (by name), after
  the actors the code spawns at its top level and before `start()`. From then on it is an
  actor like any other: it moves however its `update()` says, from map to map if it walks
  there. The map only holds where it starts.
- A map that places an actor the game does not have stops the game with an error naming
  the map and the actor.

In the map file, an actor is its name, its feet, in game pixels from the map's top left
corner (actors move with their map, and the ones left outside when a map shrinks go), then
the values set for this one alone, by variable name:

```json
  "actors": [
    { "actor": "villager", "x": 40, "y": 96 },
    { "actor": "villager", "x": 72, "y": 96, "lines": ["Nice weather."] }
  ]
```

### Walls

An actor with a box slides along walls and other actors by itself: there is nothing to
write in the code.

- The box is set on the **Actors** page (between Pixels and World in the switch): pick the
  actor in the list on the left, drawn large by its own `draw()` with its feet marked by a
  cross. The box is the first of its variables on the right: type its X Y W H there (↑ ↓
  add or take one, ⇧ ten), or click its row to see it on the actor, with handles: drag an edge
  or a corner to resize it, its inside to move it, anywhere else to draw a new one; the
  arrows move it, Delete clears it (the parent's box comes back), Escape or a tap away
  leaves it. It is drawn only while its row is selected. Its switch turned off takes it away; ⌘Z undoes. The box
  is a rectangle around the feet (the actor's position, its sprite's origin), the same on
  every frame of the animation (one that changed would push the actor into walls). Feet a
  bit narrower than the sprite and a few pixels high suit a top-down game: the head can
  pass in front of a wall.
- The box is a variable (see "Variables"): saved in `actors/<name>.json`, taken from the
  parent's file when the actor sets none. `this.box` is each actor's own,
  `{ x, y, width, height }`, (x, y) its top left relative to the feet: the code may change
  it as the game runs (a hero crouching), or set it to `null`.
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
  "solid": [
    { "column": 0, "row": 2, "x": 0, "y": 0, "width": 16, "height": 16 },
    { "column": 3, "row": 2, "x": 0, "y": 8, "width": 16, "height": 8 }
  ]
}
```

`tiles/<name>.json` lists the solid tiles by column and row, like the cells of a map, with
their rectangle in pixels inside the tile. It exists only when some tile is solid.

### Text and UI

```ts
screen.text('Bonjour !', 8, 8, '#f4f4f4')                 // in the game's font
screen.text(long, 8, 8, '#f4f4f4', { width: 120 })        // wrapped at 120 pixels
font().measure('Bonjour !')                               // { width, height }

spawn(Dialogue, { pages: ['Hello!', 'Nice weather.'] })   // letter by letter, page by page
spawn(Menu, { items: ['Yes', 'No'], onChoose: (i) => { … } })   // up, down, action
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
one, and the menu's cursor with `cursor`. Their text color is `color`:
`spawn(Dialogue, { pages, color: '#1a1c2c' })`.

### Music

Songs are notes, played by recorded instruments: no synthesis, no effects, no settings.
The **Music** page (after World) makes them. It works like the pixel editor: the tools on the
left (pencil, eraser, select), the song in the middle, and on the right the **tracks** (what
is painted with, like the palette) and the **songs** (like the sprites).

- **The grid** is time from left to right, in sixteenth notes (a line at every bar), and the
  notes from bottom to top (a line at every octave, its C named). A note starts and lasts a
  whole number of sixteenths. There is no key and no scale: every note is there.
- **A track is one instrument**, and so one color. Every track is on the grid: the selected
  one in front, the others dimmed. Several notes at once on a track are a chord. A drum
  (an instrument without a note) has no pitch: its track is a row of hits, under the notes.
- **The pencil** places a note of the length last used (drag to make it longer), drags a note
  by its body to move it, by its end to lengthen it. On a drum's row, a click places or
  takes away a hit. **Select** draws a box: the arrows move the notes (⇧: a bar, an octave),
  ⌘C, ⌘X, ⌘V (where playing starts), ⌘D, Delete. A click on a note's name plays it.
- **The song loops** while it is painted (Space, or Play under the grid), and a note plays as
  it is placed. The ruler on top shows the bars; a click on it sets where playing starts.
  A song ends with the bar of its last note: it grows as it is painted. Its only setting is
  its **tempo**, in beats per minute (120 unless set).

```json
{
  "tempo": 90,
  "tracks": [
    { "instrument": "harp", "notes": [[0, "C5", 4], [4, "E5", 2], [6, "G5", 2]] },
    { "instrument": "bass-drum", "notes": [[0], [8]] }
  ]
}
```

A note is `[step, pitch, length]` in sixteenths, `[step]` on a drum. The tempo is written
only when it is not 120.

**An instrument is the recording of one note.** The engine plays it, and does nothing else:

1. A note plays the recording from its start, faster or slower for its pitch.
2. When the note ends, it fades out in a tenth of a second.
3. If the note lasts longer than the recording, its last 5 waves repeat: a steady tone.

Every instrument plays at 16 kHz, 8-bit: the sound's own pixels. The engine has twenty,
usable by name in every game (`runtime/instruments/`, from the University of Iowa's
Musical Instrument Samples and VSCO 2 Community Edition, see `SOURCES.md`): winds (flute,
alto-flute, oboe, bassoon, horn, trumpet, organ), strings (violin, viola, cello,
cello-pizzicato, harp), struck (bells, marimba) and drums (bass-drum, tenor-drum, snare,
tambourine, triangle, claves). **Import an instrument…** (in the menu, or in the instrument
list) turns any recording of one note into one of the game's (`instruments/<name>.wav`):
it starts at the note, is cut before the player stops (a held sound, whose end then
repeats) or once it has died out (a strike, a pluck), is tuned exactly to its note, and is
stored at 16 kHz, 8-bit. Its `.json` holds that note; without one, it is a drum. A game's
instrument with the name of a built-in one replaces it in that game.

How a game plays its music comes later.

### Driving a game from a script

`?play` at the end of the editor's address opens straight into the game. In play mode,
`window.lucarne` drives it, one update at a time, the same way every time, even with the
page hidden (what an AI uses to test a game):

```js
lucarne.step(60, ['right'])   // 60 updates with "right" held, then shows the result
lucarne.actors()              // [{ actor: 'hero', x: 267, y: 120, speed: 1.25, box: { x: 262, y: 114, width: 10, height: 6 }, … }]
lucarne.ui()                  // { modal: 'Menu', text: ['Yes', 'No', '>'] }
lucarne.camera()              // { x: 96, y: 0, map: 'town' }
await lucarne.picture()       // the frame at game resolution, as a PNG data URL
lucarne.timings()             // milliseconds per update, per drawing, per frame
```

If the game has no code yet, ▶ shows a little night scene instead (the arrows and the
action key do something there too).

The browser cannot run TypeScript, so `lucarne dev` builds `actors/*.ts` and `code/` into
`game.js` whenever one of them changes, and again just before playing. Build errors show in the editor and
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
is made: **Pixels** (sprites and tilesets), **Actors** (each actor's box and values: the
actors on the left, the one picked in the middle, its box and variables on the right) and
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
(`runner.ts`), the world, its actors and the camera (`world.ts`: `spawn`, the actor files,
smooth motion between updates), variables and how a value is checked (`values.ts`), walls (`collision.ts`), the maps and the camera's limits (`maps.ts`), `screen.ts`, `sprites.ts`,
`fonts.ts`, the dialogue and menu (`ui.ts`), `input.ts`, the clocks (`time.ts`), songs and
instruments (`sound.ts`: the song format, how a note plays, importing a recording; the
built-in instruments in `instruments/`, made by `scripts/instruments.mjs`), and the
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
- `actors.ts`: actor files (`actors/<name>.json`), where a value comes from, and their history — no DOM, tested in `tests/actors.test.ts`
- `actortypes.ts`, `actorspage.ts`: the game's actors as its code declares them, drawn by their own code, and the Actors page
- `inspector.ts`: the variables of an actor, to set (the Actors page and the world page)
- `music.ts`: the Music page's song, tracks, tools and history — no DOM, tested in `tests/music.test.ts`
- `musicpage.ts`, `musicplayer.ts`, `instruments.ts`: the Music page, playing a song in a loop, the instruments and their import
- `app.ts`: interface, shortcuts, autosave
- `menu.ts`, `settings.ts`: the burger menu, pages, and the settings page (`game.json`, GitHub)
- `play.ts`: play mode (loads `game.js`, runs it, pause and stop, `?play` and `window.lucarne`)
- `github.ts`: GitHub sync (REST API, three-way comparison), tested in `tests/sync.test.ts`

The local server (`server/fs-plugin.mjs`) only accepts paths inside the game folder,
excluding hidden files (`.git`…), and rejects requests coming from another site.

MIT license. Icons come from [Material Symbols](https://fonts.google.com/icons) (Google, Apache 2.0 license).
