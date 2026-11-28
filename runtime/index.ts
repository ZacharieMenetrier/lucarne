// Lucarne's runtime: what a game's code imports.
//
//   import { Actor, camera, input, screen, sprite } from 'lucarne'
//
//   export default class Hero extends Actor {          // actors/hero.ts
//     create() { camera.follow(this) }
//     update() { this.move(input.x, input.y) }         // 60 times per second
//     draw() { screen.sprite(sprite('hero'), 0, 0) }   // around itself
//   }
//
// code/main.ts, when there is one, exports the game: `export default game({ … })`.

export { game, type GameConfig } from './game'
export { Actor, actorsIn, camera, find, spawn, type Area, type Values } from './world'
export { type Box } from './collision'
export { map, mapAt, type MapRect } from './maps'
export { input, type Button } from './input'
export { screen, type SpriteOptions } from './screen'
export { sprite, type Sprite } from './sprites'
export { sound, type Sound } from './sounds'
export { font, type Font, type TextOptions } from './fonts'
export { press, wait } from './scripts'
export { time } from './time'
// For game.js only (see server/build.mjs): it registers the actors.
export { registerActors } from './world'
