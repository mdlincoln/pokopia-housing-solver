import { favoritesForItems, loadItemGraph, loadPokemonData, topHouseMates } from '@/queries'
import type { AdjacencyData } from '@/solver'
import { describe, expect, it } from 'vitest'

// Six real catalog pokemon — hydration (favorites/images) comes from the
// baked catalog, while every conflict/score expectation is defined by the
// synthetic matrix below. Passing `candidateNames` keeps the ~370-entry real
// catalog from drowning these hand-crafted candidates in 0-score noise.
const NAMES = ['Bulbasaur', 'Charmander', 'Squirtle', 'Pikachu', 'Eevee', 'Snorlax']

// Builds a flat AdjacencyData over NAMES. `edges` is symmetric, keyed by
// "A|B"; values are the baked Int16 semantics: -1 (null here) = hard
// exclusion sentinel, 0 = no edge, >0 = compatibility score.
function makeAdjacency(edges: Record<string, number | null>): AdjacencyData {
  const names = [...NAMES]
  const indexByName = new Map(names.map((name, i) => [name, i] as const))
  const matrix = new Int16Array(names.length * names.length)
  for (const [key, value] of Object.entries(edges)) {
    const [a, b] = key.split('|')
    const ia = indexByName.get(a!)
    const ib = indexByName.get(b!)
    if (ia === undefined || ib === undefined) throw new Error(`unknown name in edge "${key}"`)
    const v = value === null ? -1 : value
    matrix[ia * names.length + ib] = v
    matrix[ib * names.length + ia] = v
  }
  return { names, indexByName, size: names.length, matrix }
}

async function itemCovering(favorite: string): Promise<string> {
  const graph = await loadItemGraph()
  const item = graph.itemsByFavorite.get(favorite)?.[0]?.name
  if (!item) throw new Error(`baked data is missing an item covering "${favorite}"`)
  return item
}

async function fulfilledSetFor(item: string): Promise<Set<string>> {
  const favs = await favoritesForItems([item])
  return new Set(favs.get(item) ?? [])
}

describe('topHouseMates', () => {
  it('ranks by overlap score with deterministic tie-breaks (island affinity, then codepoint name)', async () => {
    // Two candidates tie on occupant chemistry; the island-affinity tie-break
    // (B > A on affinity to Eevee) must order them BEFORE the name tie-break,
    // and a 0-score candidate stays eligible (neutral ≠ conflicting).
    const adjacency = makeAdjacency({
      'Charmander|Bulbasaur': 3,
      'Squirtle|Bulbasaur': 3,
      'Pikachu|Bulbasaur': 1,
      'Charmander|Eevee': 5, // island-affinity tie-break input
      'Squirtle|Eevee': 1,
    })

    const matches = await topHouseMates({
      occupants: ['Bulbasaur'],
      cartItemNames: [],
      excludedNames: new Set(['Bulbasaur', 'Eevee']), // Eevee = island member of another house
      adjacency,
      candidateNames: [...NAMES],
    })

    expect(matches.map((m) => m.name)).toEqual(['Charmander', 'Squirtle', 'Pikachu', 'Snorlax'])
    expect(matches[0]).toMatchObject({
      name: 'Charmander',
      overlapScore: 3,
      fulfilledCount: 0,
      score: 3,
      habitat: 'Warm',
    })
    expect(matches[0]!.image).not.toBe('')
    // Shared-favorite display fields come from real hydrated catalog data.
    const bulbaFavs = (await loadPokemonData(['Bulbasaur'])).Bulbasaur?.favorites ?? []
    for (const match of matches) {
      const occupantSet = new Set(bulbaFavs)
      expect(match.sharedFavorites).toEqual(match.favorites.filter((f) => occupantSet.has(f)))
    }
  })

  it('excludes candidates with an opposite-axis conflict vs any occupant', async () => {
    const adjacency = makeAdjacency({
      'Pikachu|Bulbasaur': null, // hard exclusion
      'Charmander|Bulbasaur': 2,
    })

    const matches = await topHouseMates({
      occupants: ['Bulbasaur'],
      cartItemNames: [],
      excludedNames: new Set(['Bulbasaur']),
      adjacency,
      candidateNames: [...NAMES],
    })

    expect(matches.map((m) => m.name)).not.toContain('Pikachu')
    expect(matches.map((m) => m.name)).toContain('Charmander')
  })

  describe('items-only tier', () => {
    it('requires fulfilledCount ≥ 1', async () => {
      // 'soft stuff' is a Bulbasaur favorite in the baked catalog.
      const item = await itemCovering('soft stuff')
      const fulfilled = await fulfilledSetFor(item)

      const hydrated = await loadPokemonData(NAMES)
      const qualifying = NAMES.filter((n) => hydrated[n]?.favorites.some((f) => fulfilled.has(f)))
      expect(qualifying.length).toBeGreaterThan(0)
      expect(qualifying.length).toBeLessThan(NAMES.length)

      const matches = await topHouseMates({
        occupants: [],
        cartItemNames: [item],
        excludedNames: new Set(),
        adjacency: makeAdjacency({}),
        candidateNames: [...NAMES],
      })

      expect(matches.map((m) => m.name).sort()).toEqual([...qualifying].sort())
      for (const match of matches) {
        expect(match.fulfilledCount).toBeGreaterThanOrEqual(1)
        expect(match.score).toBe(match.overlapScore + match.fulfilledCount)
        expect(match.fulfilledFavorites).toEqual(match.favorites.filter((f) => fulfilled.has(f)))
      }
      // Ranked by fulfilled count desc, codepoint name tie-break.
      const expectedOrder = [...qualifying].sort((a, b) => {
        const sa = hydrated[a]!.favorites.filter((f) => fulfilled.has(f)).length
        const sb = hydrated[b]!.favorites.filter((f) => fulfilled.has(f)).length
        return sb - sa || (a < b ? -1 : a > b ? 1 : 0)
      })
      expect(matches.map((m) => m.name)).toEqual(expectedOrder)

      // Candidates with zero wishlist overlap never qualify.
      expect(
        await topHouseMates({
          occupants: [],
          cartItemNames: [item],
          excludedNames: new Set(qualifying),
          adjacency: makeAdjacency({}),
          candidateNames: [...NAMES],
        }),
      ).toEqual([])
    })

    it('returns [] when nothing qualifies', async () => {
      const item = await itemCovering('lots of fire') // Charmander-only favorite set
      const fulfilled = await fulfilledSetFor(item)
      const hydrated = await loadPokemonData(NAMES)
      const qualifying = NAMES.filter((n) => hydrated[n]?.favorites.some((f) => fulfilled.has(f)))

      const matches = await topHouseMates({
        occupants: [],
        cartItemNames: [item],
        excludedNames: new Set(qualifying), // every qualifying candidate is already on the island
        adjacency: makeAdjacency({}),
        candidateNames: [...NAMES],
      })
      expect(matches).toEqual([])
    })
  })

  it('both-tier: fulfilled favorites act as +1 each, not a gate', async () => {
    // 'cute stuff' is a Squirtle favorite but not a Charmander favorite.
    // Items often fulfill several favorites, so pick one covering NOTHING on
    // Charmander's wishlist — otherwise the tie scenario collapses.
    const graph = await loadItemGraph()
    const charmanderFavs = new Set((await loadPokemonData(['Charmander'])).Charmander!.favorites)
    const item = (graph.itemsByFavorite.get('cute stuff') ?? [])
      .map((detail) => detail.name)
      .find((name) => {
        const favs = graph.favoritesByItem.get(name) ?? []
        return !favs.some((f) => charmanderFavs.has(f))
      })
    expect(item, 'baked data must have a cute-stuff item disjoint from Charmander').toBeTruthy()
    const adjacency = makeAdjacency({
      'Charmander|Bulbasaur': 1,
      'Squirtle|Bulbasaur': 1, // tie on chemistry — the stocked bonus must break it
    })

    const matches = await topHouseMates({
      occupants: ['Bulbasaur'],
      cartItemNames: [item!],
      excludedNames: new Set(['Bulbasaur']),
      adjacency,
      candidateNames: ['Charmander', 'Squirtle'],
    })

    expect(matches[0]!.name).toBe('Squirtle')
    expect(matches[0]!.fulfilledCount).toBeGreaterThanOrEqual(1)
    expect(matches[0]!.score).toBe(matches[0]!.overlapScore + matches[0]!.fulfilledCount)
    // Charmander stays eligible despite fulfilling nothing — the bonus is not a gate.
    expect(matches[1]!.name).toBe('Charmander')
    expect(matches[1]!.fulfilledCount).toBe(0)
  })

  it('excludes island-resident candidates even with a valid occupant score', async () => {
    const adjacency = makeAdjacency({ 'Charmander|Bulbasaur': 4 })

    const matches = await topHouseMates({
      occupants: ['Bulbasaur'],
      cartItemNames: [],
      // Charmander lives in another house on the island: never re-proposed.
      excludedNames: new Set(['Bulbasaur', 'Charmander']),
      adjacency,
      candidateNames: [...NAMES],
    })

    expect(matches.map((m) => m.name)).not.toContain('Charmander')
  })

  it('cross-house conflicts do not exclude candidates (conflict filter is occupants-only)', async () => {
    const adjacency = makeAdjacency({
      'Charmander|Eevee': null, // conflicts with an ISLAND member of another house
      'Charmander|Bulbasaur': 2,
    })

    const matches = await topHouseMates({
      occupants: ['Bulbasaur'],
      cartItemNames: [],
      excludedNames: new Set(['Bulbasaur', 'Eevee']),
      adjacency,
      candidateNames: [...NAMES],
    })

    expect(matches[0]!.name).toBe('Charmander')
  })

  it('honors the limit parameter', async () => {
    const matches = await topHouseMates({
      occupants: ['Bulbasaur'],
      cartItemNames: [],
      excludedNames: new Set(['Bulbasaur']),
      adjacency: makeAdjacency({}),
      limit: 2,
      candidateNames: [...NAMES],
    })
    expect(matches).toHaveLength(2)
  })
})
