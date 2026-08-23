// Fail-fast data guard for the favorite/habitat icon mappings (AC.1/AC.2).
//
// Import data ONLY through @/queries (never src/data/*), per the architecture
// note: PokemonCard's `favorites` prop and HouseRecord's `fav_*` column headers
// are both driven by pokemonData[name].favorites, so the authoritative render
// universe is the baked pokemon catalog's favorite union.

import bootstrapIconsManifest from 'bootstrap-icons/font/bootstrap-icons.json'
import { FAVORITE_ICONS } from '@/favoriteIcons'
import { HABITAT_ICONS, HABITAT_VARIANT } from '@/habitats'
import { ICON_SVG } from '@/iconSvg'
import { loadPokemonData, loadPokemonNames } from '@/queries'
import { describe, expect, it } from 'vitest'

describe('favorite and habitat icon mappings', () => {
  it('favoriteIconMappingIsComplete — every baked favorite has a mapping (exactly 43 today)', async () => {
    const names = await loadPokemonNames()
    const data = await loadPokemonData(names)

    const union = new Set<string>()
    for (const name of names) {
      for (const favorite of data[name]?.favorites ?? []) union.add(favorite)
    }

    // The completeness contract: no implicit fallback icon. A future harvest
    // that adds a favorite fails this assertion until a mapping row (and its
    // `?raw` import in src/iconSvg.ts) is added.
    expect(union.size).toBe(43)
    for (const favorite of union) {
      expect(FAVORITE_ICONS[favorite]).toBeDefined()
    }
  })

  it('habitatIconMappingIsComplete — all 6 habitats have a mapping', () => {
    const habitats = Object.keys(HABITAT_VARIANT)
    expect(habitats).toHaveLength(6)
    for (const habitat of habitats) {
      expect(HABITAT_ICONS[habitat]).toBeDefined()
    }
  })

  it('iconNamesAreValidAndUnique — every value resolves in the manifest and the bundled registry', () => {
    const manifest = bootstrapIconsManifest as Record<string, unknown>
    const values = [...Object.values(FAVORITE_ICONS), ...Object.values(HABITAT_ICONS)]

    // Visually distinct glyphs — no icon reused across (or within) the maps.
    expect(new Set(values).size).toBe(values.length)

    for (const icon of values) {
      expect(icon in manifest).toBe(true)
      expect(ICON_SVG[icon]).toBeDefined()
    }

    // Every bundled glyph is referenced by at least one mapping (no orphans).
    expect(Object.keys(ICON_SVG).length).toBe(new Set(values).size)
  })
})
