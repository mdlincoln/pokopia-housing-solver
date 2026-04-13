import { describe, expect, it, vi } from 'vitest'
import {
  clusterItemsByFavorites,
  clusterTaggedItemsForHouse,
  favoritesForItem,
  favoritesToItems,
  idealItems,
  type ItemDetails,
  type ItemScore,
} from '../items'

vi.mock('@/db', async () => {
  const { default: initSqlJs } = await import('sql.js')
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  let _db: import('sql.js').Database | null = null
  return {
    getDb: async () => {
      if (_db) return _db
      const wasmPath = resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm')
      const SQL = await initSqlJs({ locateFile: () => wasmPath })
      const dbPath = resolve(process.cwd(), 'public/pokehousing.sqlite')
      _db = new SQL.Database(new Uint8Array(readFileSync(dbPath)))
      return _db
    },
  }
})

function scoreOf(results: ItemScore[], item: string): number | undefined {
  return results.find((r) => r.item === item)?.score
}

function itemNames(items: ItemDetails[]): string[] {
  return items.map((d) => d.name)
}

describe('favoritesForItem', () => {
  it('returns all favorites fulfilled by a known item', async () => {
    const result = await favoritesForItem('Gaming Bed')
    expect(result).toContain('colorful stuff')
    expect(result).toContain('shiny stuff')
  })

  it('is case-insensitive', async () => {
    const r1 = await favoritesForItem('gaming bed')
    const r2 = await favoritesForItem('Gaming Bed')
    expect(r1).toEqual(r2)
  })

  it('returns empty list for unknown item', async () => {
    const result = await favoritesForItem('Not A Real Item')
    expect(result).toEqual([])
  })
})

describe('idealItems', () => {
  it('returns empty array for empty favorites list', async () => {
    const result = await idealItems([])
    expect(result).toEqual([])
  })

  it('returns empty array for unknown favorite', async () => {
    const result = await idealItems(['Nonexistent Favorite'])
    expect(result).toEqual([])
  })

  it('returns items for a single favorite with score 1', async () => {
    const result = await idealItems(['exercise'])
    // Exercise has exactly one item: "Punching Bag"
    expect(result).toHaveLength(1)
    expect(scoreOf(result, 'Punching Bag')).toBe(1)
  })

  it('scores items that appear in multiple input favorites', async () => {
    // "Gaming Bed" appears in both Colorful Stuff and Shiny Stuff
    const result = await idealItems(['colorful stuff', 'shiny stuff'])
    expect(scoreOf(result, 'Gaming Bed')).toBe(2)
  })

  it('returns score 1 for items unique to one favorite', async () => {
    // "Stardust" is in Shiny Stuff but not in Colorful Stuff
    const result = await idealItems(['colorful stuff', 'shiny stuff'])
    expect(scoreOf(result, 'Stardust')).toBe(1)
  })

  it('ignores unknown favorites mixed with valid ones', async () => {
    const result = await idealItems(['exercise', 'Not A Real Favorite'])
    expect(result).toHaveLength(1)
    expect(scoreOf(result, 'Punching Bag')).toBe(1)
  })

  it('returns all items from a multi-item favorite', async () => {
    const result = await idealItems(['cleanliness'])
    // Cleanliness: Bathtime set, Cleaning supplies, Shower, Bathtub, Bouncy blue bathtub, Water basin
    expect(result).toHaveLength(6)
    for (const { score } of result) {
      expect(score).toBe(1)
    }
  })

  it('scores shared items across three favorites', async () => {
    // "Bonfire" appears in both Lots of Fire and Group Activities
    // "Campfire" appears in Lots of Fire and Stone Stuff
    const result = await idealItems(['lots of fire', 'group activities', 'stone stuff'])
    expect(scoreOf(result, 'Bonfire')).toBe(2)
    expect(scoreOf(result, 'Campfire')).toBe(2)
  })

  it('multiplies scores when a favorite appears multiple times', async () => {
    // Exercise has one item: "Punching Bag"
    // Passing Exercise twice should give Punching Bag a score of 2
    const result = await idealItems(['exercise', 'exercise'])
    expect(scoreOf(result, 'Punching Bag')).toBe(2)
  })

  it('stacks duplicates with cross-favorite overlap', async () => {
    // "Gaming Bed" is in both Colorful Stuff and Shiny Stuff
    // With Shiny Stuff listed twice: Gaming Bed should score 3 (1 from Colorful + 2 from Shiny)
    const result = await idealItems(['colorful stuff', 'shiny stuff', 'shiny stuff'])
    expect(scoreOf(result, 'Gaming Bed')).toBe(3)
    // Stardust is only in Shiny Stuff, so it scores 2
    expect(scoreOf(result, 'Stardust')).toBe(2)
  })
})

describe('favoritesToItems', () => {
  it('returns empty array for empty input', async () => {
    const result = await favoritesToItems([])
    expect(result).toEqual([])
  })

  it('handles a single favorite with count 1', async () => {
    const result = await favoritesToItems([{ favorite: 'exercise', count: 1 }])
    expect(result).toHaveLength(1)
    expect(scoreOf(result, 'Punching Bag')).toBe(1)
  })

  it('multiplies item scores by favorite count', async () => {
    // Exercise appears 3 times → Punching Bag scores 3
    const result = await favoritesToItems([{ favorite: 'exercise', count: 3 }])
    expect(scoreOf(result, 'Punching Bag')).toBe(3)
  })

  it('combines counts across multiple favorites', async () => {
    // Gaming Bed is in both Colorful Stuff and Shiny Stuff
    const result = await favoritesToItems([
      { favorite: 'colorful stuff', count: 1 },
      { favorite: 'shiny stuff', count: 1 },
    ])
    expect(scoreOf(result, 'Gaming Bed')).toBe(2)
  })

  it('stacks repeated favorites with cross-favorite overlap', async () => {
    // Shiny Stuff ×2 + Colorful Stuff ×1 → Gaming Bed scores 3
    const result = await favoritesToItems([
      { favorite: 'colorful stuff', count: 1 },
      { favorite: 'shiny stuff', count: 2 },
    ])
    expect(scoreOf(result, 'Gaming Bed')).toBe(3)
    expect(scoreOf(result, 'Stardust')).toBe(2)
  })

  it('ignores favorites with count 0', async () => {
    const result = await favoritesToItems([{ favorite: 'exercise', count: 0 }])
    expect(result).toEqual([])
  })
})

describe('clusterItemsByFavorites', () => {
  it('returns empty array for empty input', async () => {
    const result = await clusterItemsByFavorites([])
    expect(result).toEqual([])
  })

  it('returns empty array for unknown favorite', async () => {
    const result = await clusterItemsByFavorites(['Nonexistent Favorite'])
    expect(result).toEqual([])
  })

  it('groups all items under one cluster for a single favorite', async () => {
    const result = await clusterItemsByFavorites(['exercise'])
    expect(result).toHaveLength(1)
    expect(result[0]!.favorites).toEqual(['exercise'])
    expect(itemNames(result[0]!.items)).toContain('Punching Bag')
  })

  it('creates separate clusters for items fulfilling different favorite subsets', async () => {
    // "Bonfire" is in both Lots of Fire and Group Activities
    // "Campfire" is only in Lots of Fire
    const result = await clusterItemsByFavorites(['lots of fire', 'group activities'])

    expect(result.length).toBeGreaterThanOrEqual(2)

    // The cluster with both favorites should appear first (2 > 1)
    expect(result[0]!.favorites).toHaveLength(2)
    expect(itemNames(result[0]!.items)).toContain('Bonfire')

    // Campfire should be in a single-favorite cluster
    const campfireCluster = result.find((c) => itemNames(c.items).includes('Campfire'))
    expect(campfireCluster).toBeDefined()
    expect(campfireCluster!.favorites).toHaveLength(1)
    expect(campfireCluster!.favorites).toContain('lots of fire')
  })

  it('ranks clusters by number of favorites descending', async () => {
    const result = await clusterItemsByFavorites([
      'lots of fire',
      'group activities',
      'stone stuff',
    ])
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.favorites.length).toBeLessThanOrEqual(result[i - 1]!.favorites.length)
    }
  })

  it('uses alphabetical tie-break when coverage is equal', async () => {
    const result = await clusterItemsByFavorites(['exercise', 'cleanliness'])
    const singleFavoriteClusters = result.filter((cluster) => cluster.favorites.length === 1)
    expect(singleFavoriteClusters[0]!.favorites).toEqual(['cleanliness'])
    expect(singleFavoriteClusters[1]!.favorites).toEqual(['exercise'])
  })

  it('deduplicates input favorites case-insensitively', async () => {
    const result = await clusterItemsByFavorites(['Exercise', 'exercise', 'EXERCISE'])
    expect(result).toHaveLength(1)
    expect(itemNames(result[0]!.items)).toContain('Punching Bag')
  })

  it('every item in a cluster fulfills all of that cluster favorites', async () => {
    // Verify the invariant: items in a cluster are interchangeable
    const result = await clusterItemsByFavorites(['lots of fire', 'group activities'])
    // The 2-favorite cluster should only contain items in BOTH catalog entries
    const topCluster = result[0]!
    expect(topCluster.favorites).toHaveLength(2)
    // Bonfire appears in both Lots of Fire and Group Activities
    expect(itemNames(topCluster.items)).toContain('Bonfire')
    // Torch only appears in Lots of Fire, not Group Activities — should NOT be here
    expect(itemNames(topCluster.items)).not.toContain('Torch')
  })
})

// @lat: [[items#clusterTaggedItemsForHouse]]
describe('clusterTaggedItemsForHouse', () => {
  it('returns only items with relaxation, decoration, or toy tags', async () => {
    // 'exercise' has both tagged (Punching Bag / Toy) and untagged items in the catalog
    const result = await clusterTaggedItemsForHouse(['exercise'])
    expect(result.length).toBeGreaterThan(0)
    const validTags = new Set(['Relaxation', 'Decoration', 'Toy'])
    for (const cluster of result) {
      for (const item of cluster.items) {
        expect(item.tag).not.toBeNull()
        expect(validTags.has(item.tag!)).toBe(true)
      }
    }
  })

  it('groups items by the set of house favorites they cover', async () => {
    // exercise → Punching Bag only; cleanliness → separate items
    const result = await clusterTaggedItemsForHouse(['exercise', 'cleanliness'])
    const favoriteKeys = result.map((c) => c.favorites.join(','))
    expect(favoriteKeys).toContain('exercise')
    expect(favoriteKeys).toContain('cleanliness')
  })

  it('scores clusters higher when more pokemon share the covered favorites', async () => {
    // 2× exercise + 1× cleanliness: exercise cluster scores 2, cleanliness scores 1
    const result = await clusterTaggedItemsForHouse(['exercise', 'exercise', 'cleanliness'])
    expect(result.length).toBeGreaterThan(0)
    // exercise cluster (score 2) must appear before cleanliness cluster (score 1)
    const exerciseIdx = result.findIndex((c) => c.favorites.includes('exercise'))
    const cleanlinessIdx = result.findIndex((c) => c.favorites.includes('cleanliness'))
    expect(exerciseIdx).toBeGreaterThanOrEqual(0)
    expect(cleanlinessIdx).toBeGreaterThanOrEqual(0)
    expect(exerciseIdx).toBeLessThan(cleanlinessIdx)
  })

  it('returns an empty array when no favorites match tagged items', async () => {
    const result = await clusterTaggedItemsForHouse(['not a real favorite'])
    expect(result).toHaveLength(0)
  })
})
