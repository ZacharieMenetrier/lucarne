# Maps and collisions: what was decided

Notes for the thread that builds them. Nothing here exists yet.

## Maps

- Painted in the editor, saved as `maps/<name>.json`. The engine draws the map itself,
  under the things and through the camera, which then probably makes `game.draw()` useless.
- Only the visible tiles are drawn (the rectangle of the grid under the camera, about
  25 × 15 tiles per layer at 384 × 216 with 16 px tiles). No pre-drawn chunks: tiles can
  change at any time (hoed soil), and animated tiles just work.
- The map gives the world its size: the camera stops at its edges.
- Tile size is chosen per game with no setting: it is the size of the tiles drawn.

## Terrains: dual grid

- The map stores one terrain per cell (grass, dirt, water), not tile numbers.
- Tiles are drawn on a second grid offset by half a tile; each looks at the 4 cells around
  its corner: 16 tiles per terrain.
- Terrains are stacked in a fixed order; each draws only where it is, over the ones
  below, so no tiles between pairs of terrains are needed.
- One image per terrain, in `terrains/`, as an ordinary sprite: one frame is the 16 tiles
  in a 4 × 4 block (one fixed layout, chosen so the block reads as one continuous drawing),
  animation is more frames side by side. Tile size = frame width / 4.
- Not one image for all terrains: their animations differ (frame counts, durations).
- Later: variations (extra full tiles scattered, always the same for a given cell).

## Props and connected props

- Trees, rocks, houses: props, sprites placed on the map, sorted by y with the things,
  solid through a footprint (a box at the trunk, not the whole sprite).
- Fences, low walls, hedges: connected props, placed per cell, picking one of 16 shapes
  from their 4 neighbors (normal grid). Same image convention as terrains: a 4 × 4 block,
  frames for animation. Pieces may be taller than a tile, standing on the bottom of their
  cell.

## Height: cliffs and stairs

- The map stores a height per cell (0, 1, 2…). The engine draws cliffs where height
  changes (dual grid on height, plus the face hanging below the higher area), from one
  image in a fixed layout.
- You cannot walk between levels, except through a stair: a prop placed in a cliff face
  that opens a passage.
- Plateaus and faces are ground: under all things, so y-sorting still holds.
- Not planned: two levels on the same cell (bridges over walkers), which needs a real `z`.
- Open question for the user: does Lutin need real levels, or flat ground with walls first?

## Collisions

- Axis-aligned boxes, no rotation, no physics engine.
- A solid thing declares its footprint, a box at its feet; no box, not solid. Solid
  terrains (water) and solid tiles are marked in the editor; props get a box.
- `move(dx, dy)` (already the way things move) goes along x, then y, stopping exactly at
  walls: sliding along them. Large moves are cut into small steps.
- Overlaps that don't block (an item, a door, an NPC to talk to) are queries made in
  `update()`, e.g. `this.touching(Npc)`. A spatial grid inside the engine.
