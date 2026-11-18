// Lucarne's runtime: what a game's code imports.
//
//   import { game, screen, input, sprite, time } from 'lucarne'
//
//   let x = 160
//   export default game({
//     update() { x += input.x },                 // 60 times per second
//     draw() { screen.clear('#1a1c2c'); screen.rect(x, 90, 8, 8, '#ffcd75') },
//   })
//
// `code/main.ts` must export the game as its default export.

export { game, type GameConfig } from './game'
export { input, type Button } from './input'
export { screen, type SpriteOptions } from './screen'
export { sprite, type Sprite } from './sprites'
export { time } from './time'
