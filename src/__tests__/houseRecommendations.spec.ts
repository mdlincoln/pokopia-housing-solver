import {
  buildRecommendationRow,
  buildRecommendationRows,
  compareRows,
  favoriteCellTitle,
  houseFavoriteColumns,
  sameFavorites,
  type FavoriteColumn,
  type RecommendationRow,
} from '@/houseRecommendations'
import type { ItemDetails } from '@/queries'
import type { PokemonData } from '@/solver'
import { describe, expect, it } from 'vitest'

function item(overrides: Partial<ItemDetails> = {}): ItemDetails {
  return {
    name: 'Punching Bag',
    isCraftable: true,
    category: 'Relaxation',
    flavorText: 'A sturdy bag.',
    picturePath: 'images/punching-bag.png',
    tag: 'Toy',
    ...overrides,
  }
}

function row(itemData: ItemDetails, overrides: Partial<RecommendationRow> = {}): RecommendationRow {
  return {
    itemData,
    name: itemData.name,
    craftability: 'Craftable (Relaxation)',
    added: false,
    recOrder: 0,
    col_toy: itemData.tag === 'Toy',
    col_relaxation: itemData.tag === 'Relaxation',
    col_decoration: itemData.tag === 'Decoration',
    ...overrides,
  }
}

const pokemonData: PokemonData = {
  AlphaOne: { image: '', favorites: ['exercise', 'cleanliness'], habitat: 'Dark' },
  AlphaTwo: { image: '', favorites: ['exercise'], habitat: 'Dark' },
}

describe('sameFavorites', () => {
  it('returns true only for equal sets regardless of iteration order', () => {
    expect(sameFavorites(new Set(), new Set())).toBe(true)
    expect(sameFavorites(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true)
  })

  it('returns false for different contents or sizes', () => {
    expect(sameFavorites(new Set(['a']), new Set(['b']))).toBe(false)
    expect(sameFavorites(new Set(['a']), new Set(['a', 'b']))).toBe(false)
    expect(sameFavorites(new Set(), new Set(['a']))).toBe(false)
  })
})

describe('houseFavoriteColumns', () => {
  it('orders by count descending then localeCompare', () => {
    const cols = houseFavoriteColumns(['AlphaOne', 'AlphaTwo'], pokemonData)
    expect(cols).toEqual([
      { favorite: 'exercise', count: 2 },
      { favorite: 'cleanliness', count: 1 },
    ])
  })

  it('breaks equal counts alphabetically via localeCompare', () => {
    const data: PokemonData = {
      One: { image: '', favorites: ['zeta', 'alpha', 'mid'], habitat: 'Dark' },
      Two: { image: '', favorites: ['zeta'], habitat: 'Bright' },
    }
    const cols = houseFavoriteColumns(['One', 'Two'], data)
    expect(cols).toEqual([
      { favorite: 'zeta', count: 2 },
      { favorite: 'alpha', count: 1 },
      { favorite: 'mid', count: 1 },
    ])
  })

  it('returns an empty list for pokemon with no favorites', () => {
    const data: PokemonData = { Bare: { image: '', favorites: [], habitat: 'Dark' } }
    expect(houseFavoriteColumns(['Bare'], data)).toEqual([])
  })
})

describe('buildRecommendationRow', () => {
  const cols: FavoriteColumn[] = [
    { favorite: 'exercise', count: 2 },
    { favorite: 'cleanliness', count: 1 },
  ]

  it('sets tag and favorite coverage booleans and success cell variants', () => {
    const r = buildRecommendationRow(
      item({ name: 'Punching Bag', tag: 'Toy' }),
      false,
      0,
      ['exercise'],
      new Set<string>(),
      cols,
      new Set<string>(),
    )
    expect(r.col_toy).toBe(true)
    expect(r.col_relaxation).toBe(false)
    expect(r.col_decoration).toBe(false)
    expect(r['fav_exercise']).toBe(true)
    expect(r['fav_cleanliness']).toBe(false)
    expect(r._cellVariants).toEqual({
      col_toy: 'success',
      fav_exercise: 'success',
    })
  })

  it('grays an unadded row covering an already-fulfilled favorite', () => {
    const r = buildRecommendationRow(
      item({ name: 'Punching Bag', tag: 'Toy' }),
      false,
      0,
      ['exercise'],
      new Set(['exercise']),
      cols,
      new Set<string>(),
    )
    expect(r._cellVariants).toEqual({
      col_toy: 'success',
      fav_exercise: 'secondary',
    })
  })

  it('grays an unadded row whose tag is already fulfilled', () => {
    const r = buildRecommendationRow(
      item({ name: 'Punching Bag', tag: 'Toy' }),
      false,
      0,
      [],
      new Set<string>(),
      cols,
      new Set(['Toy']),
    )
    expect(r._cellVariants?.col_toy).toBe('secondary')
  })

  it('keeps the success highlight for added rows regardless of fulfillment', () => {
    const r = buildRecommendationRow(
      item({ name: 'Punching Bag', tag: 'Toy' }),
      true,
      3,
      ['exercise'],
      new Set(['exercise']),
      cols,
      new Set(['Toy']),
    )
    expect(r.added).toBe(true)
    expect(r._cellVariants).toEqual({
      col_toy: 'success',
      fav_exercise: 'success',
    })
  })

  it('omits _cellVariants when nothing is covered', () => {
    const r = buildRecommendationRow(
      item({ name: 'Buyable', tag: null }),
      false,
      0,
      [],
      new Set<string>(),
      cols,
      new Set<string>(),
    )
    expect(r._cellVariants).toBeUndefined()
  })
})

describe('compareRows', () => {
  const sortByFooDesc = [{ key: 'name', order: 'desc' as const }]
  const noSort: [] = []

  it('sorts added rows above unadded rows regardless of sort', () => {
    const added = row(item({ name: 'Zeta' }), { added: true, recOrder: 5 })
    const unadded = row(item({ name: 'Alpha' }), { added: false, recOrder: 0 })
    expect(compareRows(added, unadded, sortByFooDesc)).toBe(-1)
    expect(compareRows(unadded, added, sortByFooDesc)).toBe(1)
    expect(compareRows(added, unadded, noSort)).toBe(-1)
  })

  it('applies numeric-aware localeCompare on the sortBy keys (asc)', () => {
    const a = row(item({ name: 'item2' }), { added: false, recOrder: 0 })
    const b = row(item({ name: 'item10' }), { added: false, recOrder: 1 })
    // numeric-aware: "item2" < "item10" => a before b
    expect(compareRows(a, b, [{ key: 'name', order: 'asc' }])).toBeLessThan(0)
    expect(compareRows(b, a, [{ key: 'name', order: 'asc' }])).toBeGreaterThan(0)
  })

  it('inverts the comparison on desc', () => {
    const a = row(item({ name: 'item2' }), { added: false, recOrder: 0 })
    const b = row(item({ name: 'item10' }), { added: false, recOrder: 1 })
    expect(compareRows(a, b, [{ key: 'name', order: 'desc' }])).toBeGreaterThan(0)
  })

  it('falls back to recOrder when the sort keys are equal', () => {
    const a = row(item({ name: 'same' }), { added: false, recOrder: 0 })
    const b = row(item({ name: 'same' }), { added: false, recOrder: 4 })
    expect(compareRows(a, b, [{ key: 'name', order: 'asc' }])).toBeLessThan(0)
    expect(compareRows(b, a, [{ key: 'name', order: 'asc' }])).toBeGreaterThan(0)
    expect(compareRows(a, b, noSort)).toBeLessThan(0)
  })
})

describe('favoriteCellTitle', () => {
  it('returns undefined for non-favorite cell keys', () => {
    const r = row(item())
    expect(favoriteCellTitle(r, 'col_toy', new Set())).toBeUndefined()
    expect(favoriteCellTitle(r, 'name', new Set())).toBeUndefined()
  })

  it('describes an in-cart item as actively fulfilling the need', () => {
    const r = row(item({ name: 'Punching Bag' }), { added: true })
    expect(favoriteCellTitle(r, 'fav_exercise', new Set())).toBe(
      'Punching Bag is fulfilling exercise',
    )
  })

  it('describes an unadded item covering a still-unfulfilled need', () => {
    const r = row(item({ name: 'Punching Bag' }))
    expect(favoriteCellTitle(r, 'fav_exercise', new Set())).toBe(
      'Punching Bag could fulfill exercise if it were placed in this house',
    )
  })

  it('describes an unadded item covering an already-fulfilled need as redundant', () => {
    const r = row(item({ name: 'Punching Bag' }))
    expect(favoriteCellTitle(r, 'fav_exercise', new Set(['exercise']))).toBe(
      'Punching Bag would fulfill exercise, but it is fulfilled by other items already placed in this house.',
    )
  })
})

describe('buildRecommendationRows', () => {
  const cols: FavoriteColumn[] = [{ favorite: 'exercise', count: 1 }]

  it('emits a base row per recommendation and an added-only row per extra cart item', () => {
    const rec = item({ name: 'Recommendation A', tag: 'Toy' })
    const inCart = item({ name: 'Recommendation A', tag: 'Toy', isCraftable: false })
    const extra = item({ name: 'Cart Only B', tag: 'Relaxation' })
    const rows = buildRecommendationRows({
      recommendations: [rec],
      cartItems: [inCart, extra],
      favByItem: new Map([
        ['Recommendation A', ['exercise']],
        ['Cart Only B', []],
      ]),
      fulfilledFavoriteSet: new Set<string>(),
      favoriteColumns: cols,
      fulfilledTags: new Set<string>(),
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]!.name).toBe('Recommendation A')
    expect(rows[0]!.added).toBe(true)
    expect(rows[0]!.recOrder).toBe(0)
    expect(rows[1]!.name).toBe('Cart Only B')
    expect(rows[1]!.added).toBe(true)
    expect(rows[1]!.recOrder).toBe(1)
  })

  it('marks a base recommendation not in the cart as unadded', () => {
    const rec = item({ name: 'Recommendation A', tag: 'Toy' })
    const rows = buildRecommendationRows({
      recommendations: [rec],
      cartItems: [],
      favByItem: new Map([['Recommendation A', ['exercise']]]),
      fulfilledFavoriteSet: new Set<string>(),
      favoriteColumns: cols,
      fulfilledTags: new Set<string>(),
    })
    expect(rows[0]!.added).toBe(false)
  })
})
