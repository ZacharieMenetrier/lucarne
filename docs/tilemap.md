# Tilemap v1: the plan

The v1 below is built (README: "Maps", and the world editor's controls). What is left is
under "Later". Two details settled while building it: the Tile tool's key is B (the
pencil's), and a block of tiles dragged on a map repeats whole, on a grid of its own size.

The v1 is deliberately small: tilesets drawn in the editor, maps painted by hand with their
tiles, all sitting in one world, and the engine drawing them under the things. Everything
else waits (see "Later").

## One world

The whole game sits in one world, the way every sprite sits on one board: each map has its
place in it, and every map is loaded when the game starts. So there is no current map to
choose and nothing to switch: things live in world coordinates, and a door is
`hero.place(x, y)` to a spot in another map (a house's inside is a map placed anywhere,
away from the town).

## Game settings: `game.json`

The settings of the whole game move to one file at the root of the game folder:

```json
{ "width": 384, "height": 216, "tileSize": 16 }
```

- `width` and `height` are the resolution. They leave `game()` (where they are today) and
  keep their defaults, 320 and 180. `game()` keeps what is code: `start()` and `draw()`.
- `tileSize` is a setting of the whole game, because everything made of tiles depends on
  it: the tilesets, the maps, and later autotiles. Its default is 16, the most common size
  in pixel art, so most games never write it.
- Every setting is optional, and a game with no `game.json` gets the defaults. The file is
  written by the editor (on the settings page), never typed.
- Why not in the code: the editor needs these settings to paint maps and to show the
  screen's size, and reading them from the code would mean running the game (which creates
  its things), and would break painting whenever the code does not build.
- `tileSize` cannot be changed once a map exists: every map would be cut differently. The
  settings page says so instead of offering it.
- The resolution cannot grow beyond the smallest map (see "Maps"): the settings page names
  the maps that are too small.

## Tilesets

- Any number of them, in `tiles/<name>.png`, with no `.json`: the tile size says how to cut
  them. A game can use tiles bought or downloaded as separate images without merging them.
- Their width and height are multiples of the tile size: **New tileset** in the menu asks
  for a name and a size in tiles, and resizing one on the board snaps to whole tiles.
- They sit on the board like sprites, drawn with the same pixel tools, with their tile grid
  shown. On the board (`board.json`) they are named `tiles/<name>`, so a tileset and a
  sprite can share a name.
- A tile is identified by its column and row in its tileset, not by a running number: a
  tileset can then grow to the right or downward without moving the tiles maps use.
- Renaming a tileset renames it in every map. Deleting one is refused while a map uses it,
  and the editor names the maps.

## Maps

`maps/<name>.json`:

```json
{
  "version": 1,
  "x": 0,
  "y": 0,
  "width": 40,
  "height": 30,
  "tilesets": ["outdoor", "house"],
  "cells": [[0, 3, 1], [0, 3, 1], null, …]
}
```

- `x` and `y` are the map's place in the world, and `width` and `height` its size, all in
  cells. The place is in the map's own file because the game uses it: it is not an editor
  setting like `board.json`.
- Maps never overlap; they can touch.
- A map is never smaller than the screen (`width` × `height` of `game.json`, rounded up to
  whole cells), so that the maps around the one shown never appear.
- `cells` lists them row by row, from the top left:
  each one is `[tileset, column, row]`, the tileset by its place in `tilesets`, or `null`
  for an empty cell (the background drawn by `game({ draw })` shows through).
- `tilesets` lists only the tilesets the map uses; the editor keeps it up to date.

### In the game

- The engine draws the maps itself, through the camera, after `game({ draw })` and under
  the things. It draws only the tiles on screen (about 25 × 15 at 384 × 216 with 16 px
  tiles), with no pre-drawn picture of a map, so a tile can change at any time.
- The camera stays inside the map that holds the thing it follows (the map under the
  thing's position), and stops at its edges.
- When that thing enters another map (walking into a map that touches, or placed through a
  door), the camera snaps to the new map at once, with no slide, and stays inside it.
- Outside every map, and in a game with no map, the camera follows as today. A camera the
  game moves itself (`camera.x`, `camera.y`) goes where it is told.
- Tiles are drawn on the game's pixel grid like everything else, so the map scrolls as
  smoothly as the things.

## World editor

The world editor is its own screen, not the board: maps will hold more than tiles (props,
later), and need their own tools and the whole view. It shows the whole world, every map at
its place, at the same scale, like the board shows every sprite.

- The menu opens it; Esc (or the menu) goes back to the board.
- Zoom and pan as on the board, with the tile grid shown, and every map's name above it.
- **New map** asks for a name and places the map, at the screen's size, in free space next
  to the others.
- Maps are moved and resized exactly like sprites on the board, with the same tools and
  gestures: the move tool (V) drags a map, and a map is resized from any of its corners.
  Both snap to whole cells, and stop against neighbors as sprites do.
- Resizing from the top or the left moves the map's place in the world, and its tiles stay
  where they are in the world: only cells at the edge are added or removed.
- A map can never be resized below the size of one screen.
- A frame of the screen's size (`width` × `height`) follows the pointer, to see what one
  screen of the game holds.
- A panel beside the map shows the game's tilesets, one under the other, with their grid.
  It only picks tiles: it does not draw. Tilesets are drawn on the board, so there is one
  pixel editor, not two.
- Tools:
  - **Tile**: pick a tile in the panel, or drag over several to pick a block; then click or
    drag on any map to stamp it.
  - **Eraser**: empties cells.
  - **Eyedropper**: on the map, picks the tile under it (and shows it in the panel).
- Undo and redo work as on the board, and the maps are saved like everything else, about
  0.4 s after the last change.
- On iPad, the same with the toolbar, and the panel folds away.

## Code layout

- `runtime/`: the maps (loading, drawing what is on screen, the map under a point, the
  camera's limits and snapping), and
  `game.json` read by `runner.ts` instead of `game()`.
- `editor/src/`:
  - `tileset.ts` / `map.ts`: the formats, with no DOM, tested in `tests/` like `sprite.ts`.
  - `world.ts`: the world screen's state and tools, with no DOM, tested with vitest like
    `editor.ts`; its view and input next to it. (`runtime/world.ts` is the game's world
    of things: a different file in a different folder.)
  - `project.ts`: reads and writes `game.json`, `tiles/` and `maps/`.
  - `play.ts`: loads the tilesets and the maps before the game's code runs, like sprites.
  - `github.ts`: syncs `game.json`, `tiles/*` and `maps/*`.
- README: the files (`game.json`, `tiles/`, `maps/`), the controls, the code layout.

## Order of work

1. `game.json`: the settings page, the runner reading it, `width` and `height` out of
   `game()`, README. No compatibility with the old API: everything is early.
2. Tilesets: `tiles/`, New tileset, the tile grid on the board, resizing by whole tiles,
   renaming and deleting, sync.
3. Maps in the engine: the format, drawing the visible tiles, the camera staying in the
   map of the thing it follows and snapping between maps. Tested with map files written
   by hand before the world screen exists.
4. The world screen: New map, moving and resizing maps, the tileset panel, the tile tool,
   eraser, eyedropper, the screen frame, undo.

Each step is checked on a throwaway game (`npm run dev -- "$TMPDIR/lucarne-test-game"
--port 5174`), never on a real game's files.

## Later

- **v2**: a small picture-in-picture of the map on the board, which redraws as a tileset is
  drawn, to see a tile change in place.
- Collisions: solid tiles, and boxes on things.
- Props on the map (trees, rocks, houses), sorted by `y` with the things.
- The code reading and changing tiles (hoed soil, an opened door).
- How the code finds places in the world (where a door leads, where the hero starts):
  the user has ideas for it.
- Autotiles with a dual grid, animated tiles, several layers, rectangle and fill tools for
  tiles.
