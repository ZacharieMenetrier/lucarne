// Lucarne's runtime: what a game's code imports.
//
//   import { game, Thing, camera, screen, sprite, input } from 'lucarne'
//
//   class Hero extends Thing {
//     update() { this.move(input.x, input.y) }          // 60 times per second
//     draw() { screen.sprite(sprite('hero'), 0, 0) }   // around itself
//   }
//
//   camera.follow(new Hero(160, 90))
//   export default game({ draw() { screen.clear('#1a1c2c') } })
//
// `code/main.ts` must export the game as its default export.

export { game, type GameConfig } from './game'
export { Thing, camera } from './world'
export { map, mapAt, type MapRect } from './maps'
export { input, type Button } from './input'
export { screen, type SpriteOptions } from './screen'
export { sprite, type Sprite } from './sprites'
export { font, type Font, type TextOptions } from './fonts'
export { Dialogue, Menu } from './ui'
export { time } from './time'
