// Spawn-condition → Bootstrap Icons glyph mapping for the habitat-detail modal.
//
// SPAWN_TIME_ICONS covers the union of baked times and SPAWN_WEATHER_ICONS
// the union of baked weathers (values of src/data/habitats.json roster rows),
// so a habitat modal chips row always resolves a glyph.
// SPAWN_RARITY_VARIANT maps normalized rarities to Bootstrap badge variants;
// null rarity renders the muted secondary "Unknown" badge.
//
// Values are bootstrap-icons kebab names WITHOUT the `bi-` prefix; the SVG
// markup for each is bundled via Vite `?raw` imports in src/iconSvg.ts.
//
// Deliberate cross-map glyph sharing: `sun-fill` (Dry habitat axis) also
// renders Day, `moon-stars-fill` (Dark) also renders Night, and
// `brightness-high-fill` (Bright) also renders the Sun weather. The habitat
// axis and spawn-condition contexts never co-render on the same element.
//
// Fail-fast guard: src/__tests__/favoriteIcons.spec.ts asserts the union of
// all baked times is exactly the set of SPAWN_TIME_ICONS keys (and weathers
// against SPAWN_WEATHER_ICONS), so a future harvest that adds or renames a
// time/weather value fails the suite until a mapping row (and its `?raw`
// import in src/iconSvg.ts) is added.

import type { ColorVariant } from 'bootstrap-vue-next'

export const SPAWN_TIME_ICONS: Readonly<Record<string, string>> = {
  Morning: 'sunrise',
  Day: 'sun-fill',
  Evening: 'sunset',
  Night: 'moon-stars-fill',
}

export const SPAWN_WEATHER_ICONS: Readonly<Record<string, string>> = {
  Sun: 'brightness-high-fill',
  Cloud: 'cloud',
  Rain: 'cloud-rain',
}

export const SPAWN_RARITY_VARIANT: Record<string, ColorVariant> = {
  Common: 'success',
  Rare: 'warning',
  'Very Rare': 'danger',
}

export function iconForTime(time: string): string | undefined {
  return SPAWN_TIME_ICONS[time]
}

export function iconForWeather(weather: string): string | undefined {
  return SPAWN_WEATHER_ICONS[weather]
}

// Accepts normalized rarity values: null (missing) yields the muted
// 'secondary' variant used by the "Unknown" badge.
export function variantForRarity(rarity: string | null): ColorVariant {
  return rarity ? (SPAWN_RARITY_VARIANT[rarity] ?? 'secondary') : 'secondary'
}
