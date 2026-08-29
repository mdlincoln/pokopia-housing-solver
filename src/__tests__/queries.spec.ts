// Real-data guards for the spawn-habitat query helpers (no mocks — reads the
// actual baked catalogs). The critical assertion here is the solver worker
// payload contract: loadPokemonData output must NEVER carry a `spawnHabitats`
// key, even though the catalog entries do.

import {
  getHabitatDetails,
  getPokemonSprites,
  loadHabitatGraph,
  loadPokemonData,
  loadSpawnHabitatsByName,
} from '@/queries'
import { describe, expect, it } from 'vitest'

describe('spawn habitat queries (real baked catalog)', () => {
  it('loadPokemonData output has no spawnHabitats key (solver worker payload contract)', async () => {
    const data = await loadPokemonData(['Bulbasaur'])
    const entry = data['Bulbasaur']!
    expect(entry).not.toHaveProperty('spawnHabitats')
    expect(Object.keys(entry).sort()).toEqual(['favorites', 'habitat', 'image'])
  })

  it('PokemonData passed to the worker serializes without spawnHabitats for a multi-habitat pokemon', async () => {
    // Bulbasaur is the canonical multi-habitat pokemon (Tall Grass + Bench
    // with greenery in the catalog) — even its catalog entry must hydrate
    // clean.
    const data = await loadPokemonData(['Bulbasaur'])
    const structured = JSON.parse(JSON.stringify(data))
    expect(structured.Bulbasaur).not.toHaveProperty('spawnHabitats')
  })

  it('loadSpawnHabitatsByName returns ordered habitat arrays for selected names', async () => {
    const result = await loadSpawnHabitatsByName(['Bulbasaur', 'NonexistentMon'])
    expect(Object.keys(result)).toEqual(['Bulbasaur'])
    expect(result['Bulbasaur']).toEqual([
      { id: 1, name: 'Tall Grass', image: 'images/habitats/1.png' },
      { id: 22, name: 'Bench with greenery', image: 'images/habitats/22.png' },
    ])
  })

  it('loadSpawnHabitatsByName omits no-spawn pokemon', async () => {
    const result = await loadSpawnHabitatsByName(['Articuno'])
    expect(result).toEqual({})
  })

  it('loadHabitatGraph hydrates a 252-entry id-keyed Map with ordered roster data', async () => {
    const graph = await loadHabitatGraph()
    expect(graph.size).toBe(252)
    expect(graph.get(1)!.name).toBe('Tall Grass')

    // Insertion order follows baked key order (habitat id ascending).
    const ids = [...graph.keys()]
    expect(ids).toEqual([...ids].sort((a, b) => a - b))

    const bulbasaur = graph.get(1)!.pokemon.find((p) => p.name === 'Bulbasaur')!
    expect(bulbasaur.rarity).toBe('Common')
    expect(bulbasaur.times.sort()).toEqual(['Day', 'Evening', 'Morning', 'Night'])
    expect(bulbasaur.weathers.sort()).toEqual(['Cloud', 'Rain', 'Sun'])
  })

  it('getHabitatDetails returns the habitat or null', async () => {
    const habitat = await getHabitatDetails(1)
    expect(habitat!.name).toBe('Tall Grass')
    expect(habitat!.description).toContain('tall grass')

    expect(await getHabitatDetails(99999)).toBeNull()
  })

  it('getPokemonSprites maps unknown roster names to null (Porygon-Z)', async () => {
    const sprites = await getPokemonSprites(['Bulbasaur', 'Porygon-Z'])
    expect(sprites['Bulbasaur']).toBe('images/001.png')
    expect(sprites['Porygon-Z']).toBeNull()
  })
})
