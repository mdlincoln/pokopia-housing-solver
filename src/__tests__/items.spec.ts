import { describe, expect, it } from 'vitest'
import {
  clusterItemsByFavorites,
  favoritesToItems,
  idealItems,
  selectTopNonOverlappingClusters,
  type ItemCluster,
  type ItemScore,
} from '../items'

function scoreOf(results: ItemScore[], item: string): number | undefined {
  return results.find((r) => r.item === item)?.score
}

describe('idealItems', () => {
  it('returns empty array for empty favorites list', () => {
    const result = idealItems([])
    expect(result).toEqual([])
  })

  it('returns empty array for unknown favorite', () => {
    const result = idealItems(['Nonexistent Favorite'])
    expect(result).toEqual([])
  })

  it('returns items for a single favorite with score 1', () => {
    const result = idealItems(['Exercise'])
    // Exercise has exactly one item: "Punching bag"
    expect(result).toHaveLength(1)
    expect(scoreOf(result, 'Punching bag')).toBe(1)
  })

  it('scores items that appear in multiple input favorites', () => {
    // "Gaming bed" appears in both Colorful Stuff and Shiny Stuff
    const result = idealItems(['Colorful Stuff', 'Shiny Stuff'])
    expect(scoreOf(result, 'Gaming bed')).toBe(2)
  })

  it('returns score 1 for items unique to one favorite', () => {
    // "Stardust" is in Shiny Stuff but not in Colorful Stuff
    const result = idealItems(['Colorful Stuff', 'Shiny Stuff'])
    expect(scoreOf(result, 'Stardust')).toBe(1)
  })

  it('ignores unknown favorites mixed with valid ones', () => {
    const result = idealItems(['Exercise', 'Not A Real Favorite'])
    expect(result).toHaveLength(1)
    expect(scoreOf(result, 'Punching bag')).toBe(1)
  })

  it('returns all items from a multi-item favorite', () => {
    const result = idealItems(['Cleanliness'])
    // Cleanliness: Bathtime set, Cleaning supplies, Shower, Bathtub, Bouncy blue bathtub, Water basin
    expect(result).toHaveLength(6)
    for (const { score } of result) {
      expect(score).toBe(1)
    }
  })

  it('scores shared items across three favorites', () => {
    // "Bonfire" appears in both Lots of Fire and Group Activities
    // "Campfire" appears in Lots of Fire and Stone Stuff
    const result = idealItems(['Lots of Fire', 'Group Activities', 'Stone Stuff'])
    expect(scoreOf(result, 'Bonfire')).toBe(2)
    expect(scoreOf(result, 'Campfire')).toBe(2)
  })

  it('multiplies scores when a favorite appears multiple times', () => {
    // Exercise has one item: "Punching bag"
    // Passing Exercise twice should give Punching bag a score of 2
    const result = idealItems(['Exercise', 'Exercise'])
    expect(scoreOf(result, 'Punching bag')).toBe(2)
  })

  it('stacks duplicates with cross-favorite overlap', () => {
    // "Gaming bed" is in both Colorful Stuff and Shiny Stuff
    // With Shiny Stuff listed twice: Gaming bed should score 3 (1 from Colorful + 2 from Shiny)
    const result = idealItems(['Colorful Stuff', 'Shiny Stuff', 'Shiny Stuff'])
    expect(scoreOf(result, 'Gaming bed')).toBe(3)
    // Stardust is only in Shiny Stuff, so it scores 2
    expect(scoreOf(result, 'Stardust')).toBe(2)
  })
})

describe('favoritesToItems', () => {
  it('returns empty array for empty input', () => {
    const result = favoritesToItems([])
    expect(result).toEqual([])
  })

  it('handles a single favorite with count 1', () => {
    const result = favoritesToItems([{ favorite: 'Exercise', count: 1 }])
    expect(result).toHaveLength(1)
    expect(scoreOf(result, 'Punching bag')).toBe(1)
  })

  it('multiplies item scores by favorite count', () => {
    // Exercise appears 3 times → Punching bag scores 3
    const result = favoritesToItems([{ favorite: 'Exercise', count: 3 }])
    expect(scoreOf(result, 'Punching bag')).toBe(3)
  })

  it('combines counts across multiple favorites', () => {
    // Gaming bed is in both Colorful Stuff and Shiny Stuff
    const result = favoritesToItems([
      { favorite: 'Colorful Stuff', count: 1 },
      { favorite: 'Shiny Stuff', count: 1 },
    ])
    expect(scoreOf(result, 'Gaming bed')).toBe(2)
  })

  it('stacks repeated favorites with cross-favorite overlap', () => {
    // Shiny Stuff ×2 + Colorful Stuff ×1 → Gaming bed scores 3
    const result = favoritesToItems([
      { favorite: 'Colorful Stuff', count: 1 },
      { favorite: 'Shiny Stuff', count: 2 },
    ])
    expect(scoreOf(result, 'Gaming bed')).toBe(3)
    expect(scoreOf(result, 'Stardust')).toBe(2)
  })

  it('ignores favorites with count 0', () => {
    const result = favoritesToItems([{ favorite: 'Exercise', count: 0 }])
    expect(result).toEqual([])
  })
})

// Replace the last test with:
describe('clusterItemsByFavorites', () => {
  it('returns empty array for empty input', () => {
    const result = clusterItemsByFavorites([])
    expect(result).toEqual([])
  })

  it('returns empty array for unknown favorite', () => {
    const result = clusterItemsByFavorites(['Nonexistent Favorite'])
    expect(result).toEqual([])
  })

  it('groups all items under one cluster for a single favorite', () => {
    const result = clusterItemsByFavorites(['Exercise'])
    expect(result).toHaveLength(1)
    expect(result[0]!.favorites).toEqual(['Exercise'])
    expect(result[0]!.items).toContain('Punching bag')
  })

  it('creates separate clusters for items fulfilling different favorite subsets', () => {
    // "Bonfire" is in both Lots of Fire and Group Activities
    // "Campfire" is only in Lots of Fire
    const result = clusterItemsByFavorites(['Lots of Fire', 'Group Activities'])

    expect(result.length).toBeGreaterThanOrEqual(2)

    // The cluster with both favorites should appear first (2 > 1)
    expect(result[0]!.favorites).toHaveLength(2)
    expect(result[0]!.items).toContain('Bonfire')

    // Campfire should be in a single-favorite cluster
    const campfireCluster = result.find((c) => c.items.includes('Campfire'))
    expect(campfireCluster).toBeDefined()
    expect(campfireCluster!.favorites).toHaveLength(1)
    expect(campfireCluster!.favorites).toContain('Lots of Fire')
  })

  it('ranks clusters by number of favorites descending', () => {
    const result = clusterItemsByFavorites(['Lots of Fire', 'Group Activities', 'Stone Stuff'])
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.favorites.length).toBeLessThanOrEqual(result[i - 1]!.favorites.length)
    }
  })

  it('uses alphabetical tie-break when coverage is equal', () => {
    const result = clusterItemsByFavorites(['Exercise', 'Cleanliness'])
    const singleFavoriteClusters = result.filter((cluster) => cluster.favorites.length === 1)
    expect(singleFavoriteClusters[0]!.favorites).toEqual(['Cleanliness'])
    expect(singleFavoriteClusters[1]!.favorites).toEqual(['Exercise'])
  })

  it('deduplicates input favorites case-insensitively', () => {
    const result = clusterItemsByFavorites(['Exercise', 'exercise', 'EXERCISE'])
    expect(result).toHaveLength(1)
    expect(result[0]!.items).toContain('Punching bag')
  })

  it('every item in a cluster fulfills all of that cluster favorites', () => {
    // Verify the invariant: items in a cluster are interchangeable
    const result = clusterItemsByFavorites(['Lots of Fire', 'Group Activities'])
    // The 2-favorite cluster should only contain items in BOTH catalog entries
    const topCluster = result[0]!
    expect(topCluster.favorites).toHaveLength(2)
    // Bonfire appears in both Lots of Fire and Group Activities
    expect(topCluster.items).toContain('Bonfire')
    // Torch only appears in Lots of Fire, not Group Activities — should NOT be here
    expect(topCluster.items).not.toContain('Torch')
  })
})

describe('selectTopNonOverlappingClusters', () => {
  it('selects a non-overlapping set with the greatest total coverage', () => {
    const clusters: ItemCluster[] = [
      { favorites: ['A', 'B'], items: ['AB'] },
      { favorites: ['A'], items: ['A'] },
      { favorites: ['C', 'D'], items: ['CD'] },
      { favorites: ['E'], items: ['E'] },
    ]

    const result = selectTopNonOverlappingClusters(clusters, 3)
    expect(result.map((cluster) => cluster.favorites)).toEqual([['A', 'B'], ['C', 'D'], ['E']])
  })

  it('never returns overlapping favorites', () => {
    const clusters: ItemCluster[] = [
      { favorites: ['A', 'B'], items: ['AB'] },
      { favorites: ['B', 'C'], items: ['BC'] },
      { favorites: ['D'], items: ['D'] },
    ]

    const result = selectTopNonOverlappingClusters(clusters, 3)
    const used = new Set<string>()
    for (const cluster of result) {
      for (const favorite of cluster.favorites) {
        const key = favorite.toLowerCase()
        expect(used.has(key)).toBe(false)
        used.add(key)
      }
    }
  })

  it('returns at most limit clusters', () => {
    const clusters: ItemCluster[] = [
      { favorites: ['A'], items: ['A'] },
      { favorites: ['B'], items: ['B'] },
      { favorites: ['C'], items: ['C'] },
      { favorites: ['D'], items: ['D'] },
    ]

    const result = selectTopNonOverlappingClusters(clusters, 3)
    expect(result).toHaveLength(3)
  })

  it('is deterministic across equivalent coverage ties', () => {
    const clusters: ItemCluster[] = [
      { favorites: ['B'], items: ['B'] },
      { favorites: ['A'], items: ['A'] },
      { favorites: ['C'], items: ['C'] },
    ]

    const result = selectTopNonOverlappingClusters(clusters, 2)
    expect(result.map((cluster) => cluster.favorites[0])).toEqual(['A', 'B'])
  })
})
