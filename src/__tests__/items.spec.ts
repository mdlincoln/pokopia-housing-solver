import { describe, expect, it } from 'vitest'
import {
  favoriteCoverageColumnKey,
  favoritesForItem,
  favoritesForItems,
  getAggregatedIngredients,
  getItemMetadata,
  getItemPicturePath,
  getRecipeForItem,
  recommendedItemsForHouse,
  recommendedItemsForHouseAllNeeds,
} from '../queries'
// The baked item-graph payload the query layer hydrates from. No mock needed:
// the baked JSON is the real committed output of scripts/build_data.mjs.
import bakedItems from '@/data/items.json'
// Golden snapshots captured from the pre-refactor sql.js implementation by
// scripts/capture_baseline.mjs (AC.7). Inputs are recorded in the fixtures;
// the baked-data implementations must reproduce them exactly.
import recommendationsGolden from './fixtures/recommendations-golden.json'
import aggregatedGolden from './fixtures/aggregated-golden.json'

// Parity fixtures from the real DB (served via the baked item graph). Counts and
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

describe('favoritesForItems', () => {
  it('returns [] for unknown items and lists for known items', async () => {
    const result = await favoritesForItems(['Gaming Bed', 'Not A Real Item'])
    expect(result.get('Not A Real Item')).toEqual([])
    const gamingBed = result.get('Gaming Bed')!
    expect(gamingBed).toContain('colorful stuff')
    expect(gamingBed).toContain('shiny stuff')
  })

  it('dedupes repeated input names (single map entry per name)', async () => {
    const result = await favoritesForItems(['Gaming Bed', 'Gaming Bed'])
    expect(result.size).toBe(1)
    expect(result.get('Gaming Bed')).toBeDefined()
  })

  it('returns an empty map for empty input', async () => {
    const result = await favoritesForItems([])
    expect(result.size).toBe(0)
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

describe('recommendedItemsForHouseAllNeeds', () => {
  // Fixtures key on 'cleanliness', whose baked items span all three recommendation
  // tags: Shower / Cleaning Supplies / Bathtime Set are Toy, Water Basin / Bathtub /
  // Bouncy Blue Bathtub are Decoration, and Waterproof Seat is Relaxation.
  it('fixture precondition: cleanliness items span Toy and Decoration axes', async () => {
    expect((await getItemMetadata('Shower')).tag).toBe('Toy')
    expect((await getItemMetadata('Water Basin')).tag).toBe('Decoration')
  })

  it('scopes retention to favorite-relevant items, never the whole tagged catalog', async () => {
    const result = await recommendedItemsForHouseAllNeeds(['cleanliness'], [], ['Decoration'])
    expect(result.length).toBeGreaterThan(0)
    const names = result.map((r) => r.name)
    // Every retained item overlaps the house favorite; an unrelated Decoration
    // item with no cleanliness coverage must not appear.
    for (const item of result) {
      expect(await favoritesForItem(item.name)).toContain('cleanliness')
    }
    expect(names).not.toContain('Wooden Crate')
  })

  it('retains an item whose favorites are all fulfilled but whose tag is still unmet', async () => {
    // Water Basin's only house-relevant favorite (cleanliness) is fulfilled, yet
    // its Decoration tag is unmet — the tag pass alone retains it.
    const result = await recommendedItemsForHouseAllNeeds(['cleanliness'], [], ['Decoration'])
    expect(result.map((r) => r.name)).toContain('Water Basin')
  })

  it('hides an item only when both favorite coverage and tag are satisfied', async () => {
    // Toy is already fulfilled (cart contains a Toy item), Decoration still unmet.
    const result = await recommendedItemsForHouseAllNeeds(['cleanliness'], [], ['Decoration'])
    const names = result.map((r) => r.name)
    // Cleaning Supplies: Toy — its one house-relevant favorite AND its Toy tag are
    // both satisfied, so it dedupes away (unlike Water Basin's tag-still-unmet case).
    expect(names).not.toContain('Cleaning Supplies')
    // Water Basin: Decoration — favorite satisfied but tag unmet, so it stays.
    expect(names).toContain('Water Basin')
  })

  it('orders an item covering an unmet favorite AND unmet tag above one covering only the favorite', async () => {
    const result = await recommendedItemsForHouseAllNeeds(
      ['cleanliness'],
      ['cleanliness'],
      ['Decoration'],
    )
    const waterBasinIndex = result.findIndex((r) => r.name === 'Water Basin')
    const showerIndex = result.findIndex((r) => r.name === 'Shower')

    expect(waterBasinIndex).toBeGreaterThanOrEqual(0)
    expect(showerIndex).toBeGreaterThanOrEqual(0)
    // Water Basin (Decoration): favorite score 1 + tag score 1 = 2 ranks before
    // Shower (Toy): favorite score 1, no tag bonus = 1.
    expect(waterBasinIndex).toBeLessThan(showerIndex)
  })
})

describe('AC.7 ordering parity with the pre-refactor sql.js implementation', () => {
  it('recommendedItemsForHouse matches the golden snapshot for every recorded input', async () => {
    for (const { favorites, results } of recommendationsGolden.expected) {
      const actual = await recommendedItemsForHouse(favorites)
      // Exact structural equality covers ordering, values, and key order.
      expect(actual).toEqual(results)
    }
  })

  it('getAggregatedIngredients matches the golden snapshot for every recorded input', async () => {
    for (const { cartItems, results } of aggregatedGolden.expected) {
      const actual = await getAggregatedIngredients(cartItems)
      expect(actual).toEqual(results)
    }
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

describe('baked item graph', () => {
  // Reframed from the pre-refactor raw-SQL assertion: instead of spying on
  // db.exec (there is no runtime SQL anymore), assert the baked structure
  // directly carries the ordering and mappings the helpers depend on.
  it('carries the recipe for a known craftable item in deterministic order', () => {
    const recipe = bakedItems.recipeByItem['Punching Bag' as keyof typeof bakedItems.recipeByItem]
    expect(recipe).toBeDefined()
    expect(recipe.map((r) => r.ingredientName)).toEqual([
      'Beach Sand',
      'Iron Ore',
      'Twine',
      'Vine Rope',
    ])
  })

  it('maps favorites to items and items back to favorites consistently', () => {
    const forExercise =
      bakedItems.itemsByFavorite['exercise' as keyof typeof bakedItems.itemsByFavorite]
    expect(forExercise).toContain('Punching Bag')
    const punchingBagFavorites =
      bakedItems.favoritesByItem['Punching Bag' as keyof typeof bakedItems.favoritesByItem]
    expect(punchingBagFavorites).toContain('exercise')
  })
})
