// Pure unit tests for src/entityUpgrade.ts: the restore-timeSharedState
// upgrade that maps legacy entity names to canonical names via injected
// resolvers (makeEntityResolvers — no dependence on the real, currently-empty
// tombstone payload).

import { formatUnmappedAlert, upgradeSharedState } from '@/entityUpgrade'
import { makeEntityResolvers } from '@/queries'
import { describe, expect, it } from 'vitest'

// Live catalog universe for the injected resolvers; tombstone maps below
// simulate what buildTombstones bakes.
const livePokemon = ['Pikachu', 'Raichu', 'Renamed']
const liveItems = ['Punching Bag', 'Berry Pots']

// Tombstones spanning both shapes the bake emits: single-hop, chains
// (flattened at bake time), and a name-recycling trap.
const tombstones = {
  pokemon: {
    Fakemon: 'Pikachu', // old name -> canonical live name
    OlderPika: 'Renamed',
    Recycled: 'Pikachu', // tombstone old name vs live-name precedence
  },
  items: {
    OldBag: 'Punching Bag',
  },
  habitats: {},
}

const resolvers = makeEntityResolvers(livePokemon, liveItems, tombstones)

function baseState(overrides: Partial<import('@/composables/useSavedQueries').SharedState> = {}) {
  return {
    version: 2 as const,
    small: 1,
    medium: 1,
    large: 1,
    pokemon: [] as string[],
    ...overrides,
  }
}

describe('upgradeSharedState', () => {
  it('maps tombstoned pokemon names with upgraded: true and no unmapped', () => {
    const state = baseState({ pokemon: ['Fakemon', 'Renamed'] })
    const result = upgradeSharedState(state, resolvers)
    expect(result.state.pokemon).toEqual(['Pikachu', 'Renamed'])
    expect(result.unmapped).toEqual([])
    expect(result.upgraded).toBe(true)
  })

  it('resolves live catalog names as-is (canonical-first), never via the tombstone', () => {
    const state = baseState({ pokemon: ['Pikachu', 'Raichu'] })
    const result = upgradeSharedState(state, resolvers)
    expect(result.state.pokemon).toEqual(['Pikachu', 'Raichu'])
    expect(result.upgraded).toBe(false)
  })

  it('name-recycling precedence: a name that is both tombstone-old and canonical resolves to the live name', () => {
    // 'Recycled' is a tombstone old name mapping to Pikachu, but the live test
    // codex has no 'Recycled' name... add one to prove precedence.
    const recyclingResolvers = makeEntityResolvers(['Recycled'], liveItems, tombstones)
    const state = baseState({ pokemon: ['Recycled'] })
    const result = upgradeSharedState(state, recyclingResolvers)
    expect(result.state.pokemon).toEqual(['Recycled'])
    expect(result.upgraded).toBe(false)
  })

  it('drops unknown pokemon names into unmapped with type pokemon', () => {
    const state = baseState({ pokemon: ['Pikachu', 'GhostMon', 'Raichu'] })
    const result = upgradeSharedState(state, resolvers)
    expect(result.state.pokemon).toEqual(['Pikachu', 'Raichu'])
    expect(result.unmapped).toEqual([{ type: 'pokemon', name: 'GhostMon' }])
    expect(result.upgraded).toBe(true)
  })

  it('dedupes an old name and its canonical twin co-existing in one hash', () => {
    // 'Fakemon' maps to 'Pikachu'; 'Pikachu' also listed directly.
    const state = baseState({ pokemon: ['Fakemon', 'Pikachu'] })
    const result = upgradeSharedState(state, resolvers)
    // Dedupe preserves the first (mapped) occurrence.
    expect(result.state.pokemon).toEqual(['Pikachu'])
    expect(result.unmapped).toEqual([])
    expect(result.upgraded).toBe(true)
  })

  it('drops unknown cart items and reports them', () => {
    const state = baseState({
      pokemon: ['Pikachu'],
      cart: [
        { houseId: 'S1', name: 'Punching Bag', quantity: 2 },
        { houseId: 'S1', name: 'GhostItem', quantity: 1 },
      ],
    })
    const result = upgradeSharedState(state, resolvers)
    expect(result.state.cart).toEqual([{ houseId: 'S1', name: 'Punching Bag', quantity: 2 }])
    expect(result.unmapped).toEqual([{ type: 'item', name: 'GhostItem' }])
    expect(result.upgraded).toBe(true)
  })

  it('maps tombstoned cart item names and preserves houseIndex/quantity tolerance', () => {
    const state = baseState({
      pokemon: [],
      cart: [{ houseIndex: 0, name: 'OldBag', quantity: 3 }],
    })
    const result = upgradeSharedState(state, resolvers)
    expect(result.state.cart).toEqual([{ houseIndex: 0, name: 'Punching Bag', quantity: 3 }])
    expect(result.unmapped).toEqual([])
    expect(result.upgraded).toBe(true)
  })

  it('dedupes cart entries by houseId + resolved name', () => {
    const state = baseState({
      pokemon: [],
      cart: [
        { houseId: 'S1', name: 'OldBag' },
        { houseId: 'S1', name: 'Punching Bag' },
        { houseId: 'S2', name: 'OldBag' },
      ],
    })
    const result = upgradeSharedState(state, resolvers)
    expect(result.state.cart).toEqual([
      { houseId: 'S1', name: 'Punching Bag' },
      { houseId: 'S2', name: 'Punching Bag' },
    ])
    expect(result.upgraded).toBe(true)
  })

  it('keeps cart undefined when the input has no cart field', () => {
    const state = baseState({ pokemon: ['Pikachu'] })
    const result = upgradeSharedState(state, resolvers)
    expect('cart' in result.state).toBe(false)
    expect(result.upgraded).toBe(false)
  })

  it('maps pinnedPokemon composite keys and drops unmapped whole keys', () => {
    const state = baseState({
      pokemon: ['Pikachu'],
      pinnedPokemon: ['S1:Fakemon', 'S1:OlderPika', 'M2:GhostMon'],
    })
    const result = upgradeSharedState(state, resolvers)
    expect(result.state.pinnedPokemon).toEqual(['S1:Pikachu', 'S1:Renamed'])
    expect(result.unmapped).toEqual([{ type: 'pokemon', name: 'GhostMon' }])
    expect(result.upgraded).toBe(true)
  })

  it('maps checkedCartItems and placedItems composite keys the same way', () => {
    const state = baseState({
      pokemon: [],
      checkedCartItems: ['S1:OldBag', 'S1:GhostItem'],
      placedItems: ['M1:Punching Bag', 'M1:GhostItem'],
      cart: [],
    })
    const result = upgradeSharedState(state, resolvers)
    expect(result.state.checkedCartItems).toEqual(['S1:Punching Bag'])
    expect(result.state.placedItems).toEqual(['M1:Punching Bag'])
    expect(result.unmapped).toEqual([
      { type: 'item', name: 'GhostItem' },
      { type: 'item', name: 'GhostItem' },
    ])
    expect(result.upgraded).toBe(true)
  })

  it('returns a fresh object and never mutates the input state', () => {
    const state = baseState({
      pokemon: ['Fakemon', 'GhostMon'],
      pinnedPokemon: ['S1:Fakemon'],
    })
    const snapshot = JSON.parse(JSON.stringify(state))
    const result = upgradeSharedState(state, resolvers)
    expect(result.state).not.toBe(state)
    expect(state).toEqual(snapshot)
    expect(result.state.pinnedPokemon).toEqual(['S1:Pikachu'])
    expect(state.pinnedPokemon).toEqual(['S1:Fakemon'])
  })

  it('leaves legacy checkedHouses/checkedPokemon untouched (restore ignores them)', () => {
    const state = baseState({
      pokemon: ['Pikachu'],
      checkedHouses: [1, 2],
      checkedPokemon: ['GhostButIgnored'],
    })
    const result = upgradeSharedState(state, resolvers)
    expect(result.state.checkedHouses).toEqual([1, 2])
    expect(result.state.checkedPokemon).toEqual(['GhostButIgnored'])
    expect(result.unmapped).toEqual([])
    expect(result.upgraded).toBe(false)
  })

  it('a fully-clean state round-trips unchanged with upgraded: false', () => {
    const state = baseState({
      pokemon: ['Pikachu', 'Raichu'],
      cart: [{ houseId: 'S1', name: 'Punching Bag', quantity: 1 }],
      pinnedPokemon: ['S1:Pikachu'],
      checkedCartItems: ['S1:Punching Bag'],
      placedItems: ['S1:Punching Bag'],
    })
    const result = upgradeSharedState(state, resolvers)
    expect(result.state).toEqual(state)
    expect(result.unmapped).toEqual([])
    expect(result.upgraded).toBe(false)
  })

  it('treats an empty pokemon list as a no-op', () => {
    const result = upgradeSharedState(baseState(), resolvers)
    expect(result.upgraded).toBe(false)
    expect(result.unmapped).toEqual([])
  })
})

describe('formatUnmappedAlert', () => {
  it('lists both types with names and the re-search CTA', () => {
    const body = formatUnmappedAlert([
      { type: 'pokemon', name: 'Foo' },
      { type: 'pokemon', name: 'Bar' },
      { type: 'item', name: 'Baz' },
    ])
    expect(body).toContain('Pokémon: Foo, Bar')
    expect(body).toContain('Items: Baz')
    expect(body).toContain('could no longer be found and were removed')
    expect(body).toContain('Try searching for them by name')
  })

  it('omits empty type sections', () => {
    const body = formatUnmappedAlert([{ type: 'item', name: 'Baz' }])
    expect(body).not.toContain('Pokémon:')
    expect(body).toContain('Items: Baz')
  })
})
