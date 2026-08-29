// Fail-fast data guard for the favorite/habitat/spawn icon mappings.
//
// Import data ONLY through @/queries (never src/data/*), per the architecture
// note: PokemonCard's `favorites` prop and HouseRecord's `fav_*` column headers
// are both driven by pokemonData[name].favorites, so the authoritative render
// universe is the baked pokemon catalog's favorite union. Spawn times and
// weathers are driven by the baked habitat catalog's roster rows.

import bootstrapIconsManifest from 'bootstrap-icons/font/bootstrap-icons.json'
import { FAVORITE_ICONS } from '@/favoriteIcons'
import { HABITAT_ICONS, HABITAT_VARIANT } from '@/habitats'
import { ICON_SVG } from '@/iconSvg'
import { loadHabitatGraph, loadPokemonData, loadPokemonNames } from '@/queries'
import { SPAWN_TIME_ICONS, SPAWN_WEATHER_ICONS } from '@/spawnIcons'
import { describe, expect, it } from 'vitest'

// Union of all icon-name values across every mapping, including deliberate
// cross-map sharing (sun-fill = Dry+Day, moon-stars-fill = Dark+Night,
// brightness-high-fill = Bright+Sun-weather).
function allIconValues(): string[] {
  return [
    ...Object.values(FAVORITE_ICONS),
    ...Object.values(HABITAT_ICONS),
    ...Object.values(SPAWN_TIME_ICONS),
    ...Object.values(SPAWN_WEATHER_ICONS),
  ]
}

describe('favorite, habitat and spawn icon mappings', () => {
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

  it('spawnIconMappingIsComplete — the baked time/weather unions map exactly', async () => {
    const graph = await loadHabitatGraph()

    const times = new Set<string>()
    const weathers = new Set<string>()
    for (const habitat of graph.values()) {
      for (const spawn of habitat.pokemon) {
        for (const time of spawn.times) times.add(time)
        for (const weather of spawn.weathers) weathers.add(weather)
      }
    }

    // No implicit fallback glyph: a future harvest that adds or renames a
    // time/weather value fails these assertions until a mapping row (and its
    // `?raw` import in src/iconSvg.ts) is added.
    expect(times).toEqual(new Set(Object.keys(SPAWN_TIME_ICONS)))
    expect(weathers).toEqual(new Set(Object.keys(SPAWN_WEATHER_ICONS)))
  })

  it('iconNamesAreValid — every value resolves in the manifest and the bundled registry', () => {
    const manifest = bootstrapIconsManifest as Record<string, unknown>
    const values = allIconValues()

    for (const icon of values) {
      expect(icon in manifest).toBe(true)
      expect(ICON_SVG[icon]).toBeDefined()
    }
  })

  it('iconValuesAreUniqueWithinEachMap — no icon reused within a single map', () => {
    // Intra-map uniqueness keeps each render surface visually distinct.
    // Cross-map sharing is deliberate (see src/spawnIcons.ts) and allowed:
    // the habitat-axis and spawn-condition contexts never co-render.
    const maps = {
      FAVORITE_ICONS,
      HABITAT_ICONS,
      SPAWN_TIME_ICONS,
      SPAWN_WEATHER_ICONS,
    } as const
    for (const map of Object.values(maps)) {
      const values = Object.values(map)
      expect(new Set(values).size).toBe(values.length)
    }
  })

  it('iconSvgHasNoOrphans — every bundled glyph is referenced by at least one map', () => {
    const referenced = new Set(allIconValues())
    for (const icon of Object.keys(ICON_SVG)) {
      expect(referenced.has(icon), `orphaned ICON_SVG entry: ${icon}`).toBe(true)
    }
    // Union-based count: cross-map sharing means the union is smaller than
    // the sum of map sizes, but every map value must resolve in ICON_SVG.
    expect(referenced.size).toBe(Object.keys(ICON_SVG).length)
  })
})
