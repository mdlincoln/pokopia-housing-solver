import type { ColorVariant } from 'bootstrap-vue-next'

export const HABITAT_VARIANT: Record<string, ColorVariant> = {
  Dark: 'dark',
  Bright: 'warning',
  Cool: 'info',
  Warm: 'danger',
  Dry: 'secondary',
  Humid: 'success',
}

// Habitat → Bootstrap Icons glyph mapping (the three Bright↔Dark / Warm↔Cool /
// Humid↔Dry axes). Values are kebab names WITHOUT the `bi-` prefix; the SVG
// markup per name is bundled via Vite `?raw` imports in src/iconSvg.ts.
// Kept colocated with HABITAT_VARIANT so the badge variant and its glyph stay
// in the same module.
export const HABITAT_ICONS: Readonly<Record<string, string>> = {
  Bright: 'brightness-high-fill',
  Dark: 'moon-stars-fill',
  Warm: 'thermometer-sun',
  Cool: 'thermometer-snow',
  Humid: 'moisture',
  Dry: 'sun-fill',
}

// Accepts the optional PokemonCard `habitat?` prop: undefined (or an unmapped
// habitat) yields undefined so no glyph renders, matching vue-tsc typing.
export function iconForHabitat(habitat: string | undefined): string | undefined {
  return habitat ? HABITAT_ICONS[habitat] : undefined
}
