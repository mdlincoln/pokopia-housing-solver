import { getDb } from '@/db'
import { describe, expect, it, vi } from 'vitest'
import {
  favoriteCoverageColumnKey,
  favoritesForItem,
  getAggregatedIngredients,
  getItemMetadata,
  getItemPicturePath,
  getRecipeForItem,
  loadItemGraph,
  recommendedItemsForHouse,
} from '../queries'

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

// Parity fixtures from the real DB (loaded via the @/db mock above). Counts and
// metadata are tied to the currently harvested Serebii data.
const PUNCHING_BAG_METADATA = {
  isCraftable: true,
  category: 'Outdoor',
  flavorText: 'Heavy and packed full of sand. Perfect for practicing punches and kicks!',
  tag: 'Toy',
}
const PUNCHING_BAG_RECIPE: Array<{ ingredientName: string; count: number }> = [
  { ingredientName: 'Beach Sand', count: 1 },
  { ingredientName: 'Iron Ore', count: 1 },
  { ingredientName: 'Twine', count: 1 },
  { ingredientName: 'Vine Rope', count: 1 },
]

describe('favoritesForItem', () => {
  it('returns all favorites fulfilled by a known item', async () => {
    const result = await favoritesForItem('Gaming Bed')
    expect(result).toContain('colorful stuff')
    expect(result).toContain('shiny stuff')
  })

  it('returns empty list for unknown item', async () => {
    const result = await favoritesForItem('Not A Real Item')
    expect(result).toEqual([])
  })
})

describe('recommendedItemsForHouse', () => {
  it('returns only items with relaxation, decoration, or toy tags', async () => {
    const result = await recommendedItemsForHouse(['exercise'])
    expect(result.length).toBeGreaterThan(0)
    const validTags = new Set(['Relaxation', 'Decoration', 'Toy'])
    for (const item of result) {
      expect(item.tag).not.toBeNull()
      expect(validTags.has(item.tag!)).toBe(true)
    }
  })

  it('returns one dynamic boolean column per distinct favorite', async () => {
    const result = await recommendedItemsForHouse(['exercise', 'cleanliness'])
    expect(result.length).toBeGreaterThan(0)

    const exerciseKey = favoriteCoverageColumnKey('exercise')
    const cleanlinessKey = favoriteCoverageColumnKey('cleanliness')
    const punchingBag = result.find((item) => item.name === 'Punching Bag')

    expect(punchingBag).toBeDefined()
    expect(punchingBag?.[exerciseKey]).toBe(true)
    expect(punchingBag?.[cleanlinessKey]).toBe(false)
  })

  it('weights ordering by duplicated favorites from the house input', async () => {
    const result = await recommendedItemsForHouse(['exercise', 'exercise', 'cleanliness'])
    const punchBagIndex = result.findIndex((item) => item.name === 'Punching Bag')
    const waterBasinIndex = result.findIndex((item) => item.name === 'Water Basin')

    expect(punchBagIndex).toBeGreaterThanOrEqual(0)
    expect(waterBasinIndex).toBeGreaterThanOrEqual(0)
    expect(punchBagIndex).toBeLessThan(waterBasinIndex)
  })

  it('returns an empty array when no favorites match tagged items', async () => {
    const result = await recommendedItemsForHouse(['not a real favorite'])
    expect(result).toHaveLength(0)
  })
})

describe('getItemMetadata', () => {
  it('returns metadata for a known craftable item', async () => {
    const result = await getItemMetadata('Punching Bag')
    expect(result).toEqual(PUNCHING_BAG_METADATA)
  })

  it('returns the all-false/all-null contract for an unknown item', async () => {
    const result = await getItemMetadata('Not A Real Item')
    expect(result).toEqual({ isCraftable: false, category: null, flavorText: null, tag: null })
  })
})

describe('getItemPicturePath', () => {
  it('returns the picture path for a known item', async () => {
    expect(await getItemPicturePath('Punching Bag')).toBe('images/punchingbag.png')
  })

  it('returns null for an unknown item', async () => {
    expect(await getItemPicturePath('Not A Real Item')).toBeNull()
  })
})

describe('getRecipeForItem', () => {
  it('returns the multi-ingredient recipe for a craftable item, name-sorted', async () => {
    const result = await getRecipeForItem('Punching Bag')
    expect(result.map((r) => ({ ingredientName: r.ingredientName, count: r.count }))).toEqual(
      PUNCHING_BAG_RECIPE,
    )
    for (const ingredient of result) {
      expect(typeof ingredient.ingredientPicture).toBe('string')
    }
  })

  it('returns an empty list for an unknown or uncraftable item', async () => {
    expect(await getRecipeForItem('Not A Real Item')).toEqual([])
  })
})

describe('getAggregatedIngredients', () => {
  it('returns empty array for empty input', async () => {
    expect(await getAggregatedIngredients([])).toEqual([])
  })

  it('aggregates a recipe with quantity scaling', async () => {
    const result = await getAggregatedIngredients([{ name: 'Punching Bag', quantity: 3 }])
    // Each Punching Bag ingredient (count 1) scales to 3; results are name-sorted.
    expect(result.map((r) => ({ name: r.name, total: r.total }))).toEqual([
      { name: 'Beach Sand', total: 3 },
      { name: 'Iron Ore', total: 3 },
      { name: 'Twine', total: 3 },
      { name: 'Vine Rope', total: 3 },
    ])
  })

  it('sums shared ingredients across multiple cart items', async () => {
    const single = await getAggregatedIngredients([{ name: 'Punching Bag', quantity: 1 }])
    const doubled = await getAggregatedIngredients([
      { name: 'Punching Bag', quantity: 1 },
      { name: 'Punching Bag', quantity: 1 },
    ])
    expect(doubled.map((r) => ({ name: r.name, total: r.total }))).toEqual(
      single.map((r) => ({ name: r.name, total: r.total * 2 })),
    )
  })

  it('ignores non-craftable and unknown items without error', async () => {
    const result = await getAggregatedIngredients([{ name: 'Not A Real Item', quantity: 2 }])
    expect(result).toEqual([])
  })
})

describe('loadItemGraph caching', () => {
  it('runs no additional SQL after the graph is loaded', async () => {
    const db = await getDb()
    const spy = vi.spyOn(db, 'exec')
    await loadItemGraph()
    // Normalize for test order: other suites may have loaded the graph already.
    spy.mockClear()

    await recommendedItemsForHouse(['exercise'])
    await favoritesForItem('Punching Bag')
    await getItemMetadata('Punching Bag')
    await getItemPicturePath('Punching Bag')
    await getRecipeForItem('Punching Bag')
    await getAggregatedIngredients([{ name: 'Punching Bag', quantity: 2 }])

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
