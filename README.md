# Lucarne

A pixel art game engine where you draw, compose, code and play in one place.

For now: the **pixel art editor**, the **world editor**, the **music editor** and the **sound editor**.

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
`actors/*.json`, `fonts/*`, `instruments/*`, `songs/*` and `sounds/*` on the device, on GitHub, and
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
  fonts/name.png     a font: its characters in white, 16 to a row, in a fixed order (see "Text and UI")
  fonts/name.license.txt   the font's license, when it has one
  actors/hero.ts     an actor: its code (TypeScript), a class that extends Actor (see "Actors")
  actors/hero.json   its values set in the editor, its box among them, only when it has some
  instruments/lute.wav   an instrument of the game's own: one note, as it plays (16 kHz, 16-bit)
  instruments/lute.json  { "note": "C4", "volume": 4 }: the note it was recorded at (none: a
                         drum) and its volume in dB, each only when it has one
  instruments/snare.json { "volume": 6 } alone, with no .wav: the engine's snare's volume in this game
  songs/town.json    a song: its tempo, its time and its instruments' notes (see "Music")
  sounds/jump.json   a sound effect: how it is drawn and its settings (see "Sounds")
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
  ui() { screen.text('♥ 3', 4, 4, '#f4f4f4') },   // the UI, over everything (see "Text and UI")
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
- An actor draws only itself: the UI is the game's (its `ui()`, see "Text and UI").
- `find(Hero)` gives the first actor of that class in the world (or of a class that extends
  it), or null: to read the hero from anywhere.

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

A moment of an animation (a footstep on the frame where a foot lands) belongs to the actor,
which knows when its animation started: it plays the sound when the frame it draws changes to
that one (frames count from 0). `frameAt(ms)` is the frame shown `ms` into the animation:

```ts
#frame = -1   // the frame shown last; -1 when not walking

update() {
  const frame = this.walking ? walk.frameAt(time.ms - this.walkedSince) : -1
  if (frame !== this.#frame && (frame === 1 || frame === 3)) footstep.play()   // the feet land
  this.#frame = frame
}
```

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
```

Text is stamped from the font's own pixels: the browser never draws it, so it is as crisp
as the sprites, on every device. There is no font in the engine: a game that writes brings
its own, in `fonts/`. With one font there, `font()` and `screen.text` use it; with several,
name one: `font('small')`.

A font is only its image, `fonts/<name>.png`, and it sits on the board with the sprites, in
the **Fonts** panel under Tilesets. Every font has the same characters in the same cells:
ASCII, Latin-1 (French accents among them) and a few more (`Œ œ € … ' " – ← ↑ → ↓ ♥`), 16
to a row. An empty cell shows faintly which character it is for; under the font being
edited, a line is written with it. Draw a character in its cell, in any color (text takes
the color the game writes it in), and it is in the font:

- a character starts at its first column of ink, and the next one starts one pixel after
  its last: redraw a letter wider and the text makes room for it;
- a line is one cell high, a space half a cell wide;
- a character the font does not have (its cell is empty) is written as `?`.

**+** makes a font: blank, with cells of 8 × 8 pixels (drag a corner to change the size
of every cell), or a copy of a preset, each shown writing a line. The presets are free
pixel fonts that are the editor's, not the engine's (`editor/fonts/`): picking one copies
it into the game's `fonts/` with its license, to use or redraw.
They are [m5x7](https://managore.itch.io/m5x7) by Daniel Linssen (CC0: nothing asked)
and [Tiny5](https://github.com/Gissio/font_tiny5) (SIL Open Font License: free, the license
travels with it). **Import…**, in the same window, takes a pixel font file (.ttf, .otf, .woff)
together with its license file: it finds the size the font is drawn for and reads it pixel
by pixel. A font that is not made of pixels comes out as it can, to be fixed by hand.

The UI is the game's own code: the engine has no dialogue box, no menu and no HUD, since
every game wants them differently. It gives three things to write them with.

- **`ui()`**, next to `draw` in `code/main.ts`, draws the UI on the screen itself, over the
  world, in screen pixels: on every displayed frame, from what the game is now. It only
  draws: it reads the actors (`find`) and the game's own values, and changes nothing.
- **Scripts** are the game's async functions: what takes time (a line of dialogue, a menu,
  a cutscene) is written top to bottom, with `await`. A script changes values; `ui()` shows
  them. It waits on the engine only: `await wait(30)` for 30 updates (half a second;
  `wait()` for the next one), `await press('action')` for a new press of a button (the press
  that started a conversation never skips its first line). The script takes the press: one
  press does one thing, so the actors don't see it (`input.pressed` is false, `input.down`
  still true), nor does another script waiting for that button.
- **`game.paused`**, set by the game, stops the world: actors do not update, and the camera
  and the world's clock (`time.ms`) stop. Everything is still drawn, and scripts still run.
  The UI's clock (`time.uiMs`) keeps running: in `ui()`, sprites play on it. Whether the
  world stops while people talk is the game's choice.

```ts
// code/talk.ts: the game's dialogue, as it wants it
import { game, press, screen, sprite, wait } from 'lucarne'

let line = ''
let shown = 0

export async function say(text: string) {
  game.paused = true
  line = text
  for (shown = 0; shown < text.length; shown += 0.5) await wait()  // 30 letters per second
  await press('action')
  line = ''
  game.paused = false
}

export function drawTalk() {                                       // called by ui()
  if (!line) return
  screen.panel(sprite('panel'), 4, 120, 312, 52)
  screen.text(line.slice(0, shown), 12, 128, '#f4f4f4', { width: 296 })
}

// actors/villager.ts
async talk() {
  await say('Want a sword?')
  await say('Here.')
}
```

The engine keeps scripts exact: a wait ends at the start of an update, before the actors
update, and the script it wakes runs until its next wait before anything else happens.
Scripts that were waiting wake one at a time, in the order they started waiting. So a
script moves the same way on every display and when a script steps the game, as long as it
waits only on the engine (never on `setTimeout` or the network). Two scripts at once (the
hero talks to the villager twice) are the game's to prevent. A script that throws stops the
game, like any error. When the game starts again, the scripts that were waiting are gone.

### Music

Songs are notes, played by recorded instruments: no synthesis, no effects, no settings.
The **Music** page (after World) makes them. It works like the pixel editor: the tools on the
left (pencil, eraser, select), the song in the middle, and on the right the song's
**instruments** (what is painted with, like the palette) and the **songs** (like the sprites).

- **The grid** is time from left to right, in sixteenth notes (a line at every beat, a
  stronger one at every bar), and the
  notes from bottom to top (a line at every octave, its C named). A note starts and lasts a
  whole number of sixteenths. There is no key and no scale: every note is there.
- **A song has each instrument once**, and each one a color. + adds one: a click on a name
  plays it, as often as wanted, and Add takes it; one already in the song can't be picked.
  **Replace…** in an instrument's menu plays its notes with another. Every instrument is on
  the grid: the selected one filled with its color, the others as faint gray shadows behind
  it (they are edited by picking them in the list; hovering one there outlines its notes in
  its color). Several notes at once are a chord,
  but an instrument never covers itself: when a note starts while the same pitch still
  sounds there, the earlier one stops, as a string struck again starts over. A drum (an
  instrument without a note) has no pitch: it is a row of hits, under the notes.
- **Accompany** (in an instrument's menu) writes chords under the song for that instrument,
  replacing its notes (one undo). It finds the song's key, then a chord every half bar (every
  bar in 3/4) among the key's chords: the one whose notes sound the longest there, a note on
  the beat counting more. Each other instrument (not the drums) has one vote, whatever its
  number of notes: an accompaniment written before reinforces the melody it follows, without
  drowning a melody changed since (Accompany it again). A near tie keeps the chord before.
  The instrument decides how the chords are played, under the melody (the instrument that
  plays highest): held (a bow, a breath), the chord held, or its root if the instrument is
  low (recorded under C4); struck or plucked, an arpeggio in eighths, or the root on the
  chord's first beat and the fifth on the others if it is low. They are notes like any
  other, to change by hand.
- **The pencil** places a note of the length last used (drag to make it longer); a click on a
  note selects it (⇧ adds one or takes it away), dragging its body moves the notes selected,
  its end lengthens it. On a drum's row, a click places or takes away a hit. **Select** draws
  a box, or picks notes the same way: the arrows move the notes (⇧: a bar, an octave),
  ⌘C, ⌘X, ⌘V (where playing starts), ⌘D, Delete. A click on a note's name plays it.
- **Singing** (the ● button under the grid, or R) writes a melody without placing each note:
  a popup counts in with a click at the song's tempo (two bars at 120, at least 4 seconds,
  the time a microphone takes to wake up), then keeps the beat while you sing. Done (Enter,
  Space or R) turns the whole take into notes of the selected instrument, its first beat on the
  marker where playing starts. They replace what was there up to the last note sung
  (singing a passage again is how it is fixed) and come selected, to be moved if they
  landed a little off. Each note is a stretch of voice on one semitone, rounded to the
  nearest one after taking out how sharp or flat the whole take is; a slide into a note is
  that note, and a dip or a consonant ("doo doo", "frère") starts a new one. The take is
  then cleaned onto the sixteenth grid: moved by how late it was sung (the microphone's
  delay and the singer's, which the browser does not tell), following a singer who hurries
  or drags; a note is held over a breath up to the next; a single step glued to a note
  beside it is part of it. On a drum, each attack (a clap, "ts", "k") is a hit. The take is one undo;
  Escape cancels it. The notes stay in the octave sung: ⇧↑ moves them an octave. Humming
  tracks better than words. The browser only gives the microphone on localhost or https.
- **Bars** are selected by dragging across the ruler: a section, every instrument at once.
  ⌘C, ⌘X, ⌘V (where playing starts), ⌘D, Delete act on the whole section; dragging it in the
  ruler, or ← →, moves it by bars. A section pasted, duplicated or moved replaces what was on
  the bars it lands on. A click in the grid or on a note goes back to selecting notes.
- **The flag** in the ruler is always on the start of a bar: a click on a bar puts it there,
  and selecting bars puts it on the first one. **+** at the right end of its bar (of the bars
  selected) adds an empty bar right after it and pushes the rest of the song right; **−** takes its
  bar (the bars selected) out and pulls the rest left. Keys: I and ⇧Delete.
- **The selection bar** floats over the grid with the select tool, or while bars are
  selected, as on the Pixels page: Copy, Cut, Paste, Duplicate, Clear, and Done (Enter),
  which lets the selection go.
- **The song loops** while it is painted (Space, or Play under the grid), and a note plays as
  it is placed. The ruler on top shows the bars. Play plays from the flag: the whole song in a loop, or only the bars selected.
  Play again stops, and the flag stays where it was, to hear the same passage again. **Stop** (■, or Enter with nothing
  selected) goes back to the beginning with nothing selected, to hear the song from its start.
  A song ends with the bar of its last note: it grows as it is painted. It has two
  settings, under the grid: its **tempo**, in quarter notes per minute (120 unless set),
  and its **time**: 4/4 (bars of 16 sixteenths, the default), 3/4 (12 sixteenths in 3
  beats) or 6/8 (12 sixteenths in 2 beats). The time only says where the bars and beats
  fall: changing it moves no note and changes no speed.

```json
{
  "tempo": 90,
  "time": "6/8",
  "instruments": {
    "harp": [[0, "C5", 4], [4, "E5", 2], [6, "G5", 2]],
    "bass-drum": [[0], [8]]
  }
}
```

Each instrument is a key, in the order they are listed, with its notes. A note is
`[step, pitch, length]` in sixteenths, `[step]` on a drum. The tempo is written
only when it is not 120, the time only when it is not 4/4.

**An instrument is the recording of one note.** The engine plays it, and does nothing else:

1. A note plays the recording from its start, faster or slower for its pitch.
2. When the note ends, it fades out in a tenth of a second.
3. If the note lasts longer than the recording, its last 5 waves repeat: a steady tone.

Every instrument sounds as loud as the others: when it is loaded, the engine measures its
first quarter of a second and turns it up or down to the same level, so a drum's short hit
is heard next to a held flute. Its file is not changed. Then its **volume** turns it up or
down, from −12 to +12 dB, for what the measure misses (a hit covered by held notes, a low
sound heard less), set by ear in its `.json`, for every song of the game. The editor has
no control for it: the engine's instruments come with theirs, and a game's own recording
is imported at its level. A game's volume for one of the engine's is a `.json` alone in
`instruments/`.
A song that would go past full volume is turned down as a whole, every instrument by the
same amount.

Every instrument plays at 16 kHz, 16-bit: soft like an old console, without its grit. The engine has twenty,
usable by name in every game (`runtime/instruments/`, from the University of Iowa's
Musical Instrument Samples and VSCO 2 Community Edition, see `SOURCES.md`): winds (flute,
alto-flute, oboe, bassoon, horn, trumpet, organ), strings (violin, viola, cello,
cello-pizzicato, harp), struck (bells, marimba) and drums (bass-drum, tenor-drum, snare,
tambourine, triangle, claves). **Import an instrument…** (in the instrument
list) turns any recording of one note into one of the game's (`instruments/<name>.wav`):
it starts at the note, is cut before the player stops (a held sound, whose end then
repeats) or once it has died out (a strike, a pluck), is tuned exactly to its note, and is
stored at 16 kHz, 16-bit. Its `.json` holds that note; without one, it is a drum. A game's
instrument with the name of a built-in one replaces it in that game.

How a game plays its music comes later.

### Sounds

Sound effects are drawn, not recorded: a jump, a coin or an explosion is a shape in time.
The **Sounds** page (after Music) makes them: the tools on the left, the sound in the
middle with Play under it (Space), its settings and the game's sounds on the right.

- **The grid** is 24 columns of time by 24 rows of pitch, at most one pixel per column. The
  rows are a pentatonic scale (no wrong note), from C2 at the bottom to G6, a lighter row at
  every C. **The pencil** places pixels (a click on one, or the right button, erases), **the
  eraser** takes them away, and **volume** sets how loud each column is, as bars: from
  the loudest at the top down to 40 dB under it. A pixel plays as it is placed.
- **The settings** are for the whole sound, and changing one plays it. **Texture**, its
  source: Soft, Retro and Noise hold, neighbouring pixels joined in one line; Pluck, Glass,
  Wood, Water, Metal and Click are struck, every pixel a hit. **Speed**, how long a column
  lasts (Blink 1/60 s, Fast 1/30, Mid 1/20, Slow 1/12). **Grit** (Clean, Warm, Crunchy).
  **Echo**, from Off to Huge. **Ring**: a struck texture rings shorter or longer, a held one
  is cut shorter (dry) or gets a tail. **Volume**, the whole sound's, from the loudest down
  to 40 dB under it: the columns' volumes only set how loud each is next to the others.
  **Glide** slides the pitch from pixel to pixel (a
  struck sound bends rather than being struck again). **Random** makes one up, **Clear**
  takes the pixels away. Undo and redo are under the tools (⌘Z, ⇧⌘Z).

```json
{
  "texture": "retro",
  "grit": "crunchy",
  "pitch": [19, 19, 21, 21, 21, 21, 21, 21, 21],
  "volume": [23, 23, 23, 22, 20, 17, 13, 9, 5]
}
```

The texture, then each setting only when it is not the default (`"speed": "fast"`, `"grit":
"clean"`, `"glide": false`, `"echo": "off"`, `"ring": "normal"`, `"level": 23`, the volume), each column's row up to the
last pixel (`null`: empty), and its volume (0 to 23) only when one is not the loudest.

The engine makes the sound from that file, and it sounds like the music: mono, 16 kHz,
16-bit. It varies a little each time it is made (a struck pitch, noise), so repeats are not
identical. A game has only its own sounds, the ones in its `sounds/` folder. **+** next to
Sounds names a new one and picks what it starts from: empty, or one of 25 presets (coin,
jump, laser, bomb, footstep, water-drop…), each played when pressed. A preset is copied
into the game; the presets themselves are the editor's (`editor/sounds/`).

A game plays a sound by its name, as it draws a sprite:

```ts
import { Actor, input, sound } from 'lucarne'

const jump = sound('jump')            // sounds/jump.json; a wrong name fails here

export default class Hero extends Actor {
  update() {
    if (input.pressed('action')) jump.play()
  }
}
```

`play()` has no settings: how loud it is and how it sounds are in the file. The engine
decides the rest:

- **A sound played again while it still rings starts over** (the earlier one stops, without
  a click), as a string struck again does in the music: picking up coins in a row never piles
  up into something louder. Different sounds play together.
- **Repeats are not identical**: each sound is made four times (the first when the game
  loads, the others right after, in the background), and a play picks one that was not the
  last.
- **Sounds stop when the game is paused**, and wait for the first key or touch when the game
  was opened without one (`?play`): a browser plays nothing before.

### Driving a game from a script

`?play` at the end of the editor's address opens straight into the game. In play mode,
`window.lucarne` drives it, one update at a time, the same way every time, even with the
page hidden (what an AI uses to test a game). Sounds played during `step` are not heard
(many updates run at once): `step` lists them instead.

```js
await lucarne.step(60, ['right'])   // 60 updates with "right" held, then shows the result
                                    // → { ticks, actors, sounds: ['jump'] }: the sounds played, not heard
lucarne.actors()              // [{ actor: 'hero', x: 267, y: 120, speed: 1.25, box: { x: 262, y: 114, width: 10, height: 6 }, … }]
lucarne.ui()                  // the text on screen: ['♥ 3', 'Want a sword?']
lucarne.scripts()             // what each script waits on: [{ by: 'villager', waiting: 'press action' }]
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
`fonts.ts`, `input.ts`, scripts and their waits (`scripts.ts`), the clocks (`time.ts`), songs and
instruments (`sound.ts`: the song format, how a note plays, importing a recording; the
built-in instruments in `instruments/`, made by `scripts/instruments.mjs`), sound effects
(`sfx.ts`: the format and how a sound is made; the presets are in `editor/sounds/`; `sounds.ts`:
`sound()` and how a game plays them, `soundworker.ts` making their takes, `audio.ts` the page's
one audio context), and the
game's settings (`game.ts`, read from `game.json`). `game.js` holds only the game's code: the editor
provides the engine when it plays it (`server/build.mjs` explains how).

Editor code lives in `editor/src/`:

- `bitmap.ts`, `color.ts`: pixels and operations (line, fill, flip…)
- `sprite.ts`, `png.ts`: sprite format, and tilesets (`tiles/<name>` on the board)
- `map.ts`: map format (tested in `tests/world.test.ts`)
- `font.ts`, `ttf.ts`: fonts on the board (`fonts/<name>`), the presets (`editor/fonts/`), and importing a pixel font, its numbers read from the file (tested in `tests/font.test.ts`)
- `storage.ts`, `project.ts`: reading and writing the game folder (local server or OPFS)
- `board.ts`: sprite positions (`board.json`), automatic placement, resizing by a corner
- `editor.ts`: the board, tools, selection, history — no DOM, tested in `tests/`
- `viewport.ts`, `view.ts`, `input.ts`: zoom and panning, rendering the board, mouse, pen and gestures
- `world.ts`: the world editor's maps, tools, history — no DOM, tested in `tests/world.test.ts`
- `worldview.ts`, `worldpage.ts`: rendering the world, and its page
- `actors.ts`: actor files (`actors/<name>.json`), where a value comes from, and their history — no DOM, tested in `tests/actors.test.ts`
- `actortypes.ts`, `actorspage.ts`: the game's actors as its code declares them, drawn by their own code, and the Actors page
- `inspector.ts`: the variables of an actor, to set (the Actors page and the world page)
- `music.ts`: the Music page's song, instruments, tools and history — no DOM, tested in `tests/music.test.ts`
- `accompany.ts`: Accompany, the key and chords found under a song and the notes played on them — no DOM, tested in `tests/accompany.test.ts`
- `musicpage.ts`, `musicplayer.ts`, `instruments.ts`: the Music page, playing a song in a loop, the instruments and their import
- `sing.ts`: a voice made notes (pitch tracking, notes) — no DOM, tested in `tests/sing.test.ts` and scored on recorded takes in `tests/sing-takes.test.mjs`; `singdialog.ts` the popup it is sung in, `microphone.ts` hears it
- `sfx.ts`: the Sounds page's sound, strokes, settings, sound code and history — no DOM, tested in `tests/sfx.test.ts`; `sfxpage.ts` the page
- `app.ts`: interface, shortcuts, autosave
- `menu.ts`, `settings.ts`: the burger menu, pages, and the settings page (`game.json`, GitHub)
- `play.ts`: play mode (loads `game.js`, runs it, pause and stop, `?play` and `window.lucarne`)
- `github.ts`: GitHub sync (REST API, three-way comparison), tested in `tests/sync.test.ts`

The local server (`server/fs-plugin.mjs`) only accepts paths inside the game folder,
excluding hidden files (`.git`…), and rejects requests coming from another site.

MIT license. Icons come from [Material Symbols](https://fonts.google.com/icons) (Google, Apache 2.0 license).
