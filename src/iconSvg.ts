// Bundled Bootstrap Icons SVG markup registry.
//
// Each icon is statically imported from the installed bootstrap-icons package
// via Vite's `?raw` suffix, which inlines the file contents as a string at
// build time. This bundles ONLY the ~56 glyphs referenced by FAVORITE_ICONS,
// HABITAT_ICONS, SPAWN_TIME_ICONS and SPAWN_WEATHER_ICONS (a few KB total) —
// never the 1.3 MB full sprite or the icon
// web font — and the markup is a trusted build-time constant from an MIT
// package, not user input (so v-html injection in IconGlyph.vue is safe).
//
// The `*?raw` module type comes from env.d.ts's `vite/client` reference; no
// extra declaration is needed.

import activity from 'bootstrap-icons/icons/activity.svg?raw'
import alphabet from 'bootstrap-icons/icons/alphabet.svg?raw'
import asterisk from 'bootstrap-icons/icons/asterisk.svg?raw'
import bandaid from 'bootstrap-icons/icons/bandaid.svg?raw'
import basket from 'bootstrap-icons/icons/basket.svg?raw'
import binocularsFill from 'bootstrap-icons/icons/binoculars-fill.svg?raw'
import boxFill from 'bootstrap-icons/icons/box-fill.svg?raw'
import bricks from 'bootstrap-icons/icons/bricks.svg?raw'
import brightnessHighFill from 'bootstrap-icons/icons/brightness-high-fill.svg?raw'
import bucket from 'bootstrap-icons/icons/bucket.svg?raw'
import carFront from 'bootstrap-icons/icons/car-front.svg?raw'
import circleFill from 'bootstrap-icons/icons/circle-fill.svg?raw'
import cloud from 'bootstrap-icons/icons/cloud.svg?raw'
import cloudRain from 'bootstrap-icons/icons/cloud-rain.svg?raw'
import cone from 'bootstrap-icons/icons/cone.svg?raw'
import controller from 'bootstrap-icons/icons/controller.svg?raw'
import cpu from 'bootstrap-icons/icons/cpu.svg?raw'
import diagram3 from 'bootstrap-icons/icons/diagram-3.svg?raw'
import diamond from 'bootstrap-icons/icons/diamond.svg?raw'
import emojiHeartEyes from 'bootstrap-icons/icons/emoji-heart-eyes.svg?raw'
import fan from 'bootstrap-icons/icons/fan.svg?raw'
import feather from 'bootstrap-icons/icons/feather.svg?raw'
import fire from 'bootstrap-icons/icons/fire.svg?raw'
import flower1 from 'bootstrap-icons/icons/flower1.svg?raw'
import forkKnife from 'bootstrap-icons/icons/fork-knife.svg?raw'
import gem from 'bootstrap-icons/icons/gem.svg?raw'
import hammer from 'bootstrap-icons/icons/hammer.svg?raw'
import heartPulse from 'bootstrap-icons/icons/heart-pulse.svg?raw'
import leafFill from 'bootstrap-icons/icons/leaf-fill.svg?raw'
import magic from 'bootstrap-icons/icons/magic.svg?raw'
import mask from 'bootstrap-icons/icons/mask.svg?raw'
import measuringCup from 'bootstrap-icons/icons/measuring-cup.svg?raw'
import moonStarsFill from 'bootstrap-icons/icons/moon-stars-fill.svg?raw'
import moisture from 'bootstrap-icons/icons/moisture.svg?raw'
import nutFill from 'bootstrap-icons/icons/nut-fill.svg?raw'
import pencil from 'bootstrap-icons/icons/pencil.svg?raw'
import peopleFill from 'bootstrap-icons/icons/people-fill.svg?raw'
import puzzleFill from 'bootstrap-icons/icons/puzzle-fill.svg?raw'
import rainbow from 'bootstrap-icons/icons/rainbow.svg?raw'
import scissors from 'bootstrap-icons/icons/scissors.svg?raw'
import stars from 'bootstrap-icons/icons/stars.svg?raw'
import sunFill from 'bootstrap-icons/icons/sun-fill.svg?raw'
import sunrise from 'bootstrap-icons/icons/sunrise.svg?raw'
import sunset from 'bootstrap-icons/icons/sunset.svg?raw'
import thermometerSnow from 'bootstrap-icons/icons/thermometer-snow.svg?raw'
import thermometerSun from 'bootstrap-icons/icons/thermometer-sun.svg?raw'
import trashFill from 'bootstrap-icons/icons/trash-fill.svg?raw'
import treeFill from 'bootstrap-icons/icons/tree-fill.svg?raw'
import trophyFill from 'bootstrap-icons/icons/trophy-fill.svg?raw'
import tsunami from 'bootstrap-icons/icons/tsunami.svg?raw'
import volumeUpFill from 'bootstrap-icons/icons/volume-up-fill.svg?raw'
import water from 'bootstrap-icons/icons/water.svg?raw'
import wind from 'bootstrap-icons/icons/wind.svg?raw'

export const ICON_SVG: Readonly<Record<string, string>> = {
  activity,
  alphabet,
  asterisk,
  bandaid,
  basket,
  'binoculars-fill': binocularsFill,
  'box-fill': boxFill,
  bricks,
  'brightness-high-fill': brightnessHighFill,
  bucket,
  'car-front': carFront,
  'circle-fill': circleFill,
  cloud,
  'cloud-rain': cloudRain,
  cone,
  controller,
  cpu,
  'diagram-3': diagram3,
  diamond,
  'emoji-heart-eyes': emojiHeartEyes,
  fan,
  feather,
  fire,
  flower1,
  'fork-knife': forkKnife,
  gem,
  hammer,
  'heart-pulse': heartPulse,
  'leaf-fill': leafFill,
  magic,
  mask,
  'measuring-cup': measuringCup,
  'moon-stars-fill': moonStarsFill,
  moisture,
  'nut-fill': nutFill,
  pencil,
  'people-fill': peopleFill,
  'puzzle-fill': puzzleFill,
  rainbow,
  scissors,
  stars,
  'sun-fill': sunFill,
  sunrise,
  sunset,
  'thermometer-snow': thermometerSnow,
  'thermometer-sun': thermometerSun,
  'trash-fill': trashFill,
  'tree-fill': treeFill,
  'trophy-fill': trophyFill,
  tsunami,
  'volume-up-fill': volumeUpFill,
  water,
  wind,
}

export function svgForIcon(name: string): string | undefined {
  return name ? ICON_SVG[name] : undefined
}
