// Pure helpers for the HouseRecord recommendations panel, plus `sameFavorites`.
// Moved verbatim out of src/components/HouseRecord.vue so recommendation
// ordering, tooltips, and row-building are unit-testable without mounting the
// component (they were previously only exercised through e2e). Observable
// behavior must stay byte-for-byte identical.

import { favoriteCoverageColumnKey } from '@/queries'
import type { ItemDetails } from '@/queries'
import type { PokemonData } from '@/solver'
import type { BTableSortBy } from 'bootstrap-vue-next'

/** Set equality by contents: same size and every element present. */
export function sameFavorites(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const favorite of a) {
    if (!b.has(favorite)) return false
  }
  return true
}

export interface RecommendationRow extends Record<string, unknown> {
  itemData: ItemDetails
  name: string
  craftability: string
  added: boolean
  recOrder: number
  col_toy: boolean
  col_relaxation: boolean
  col_decoration: boolean
  _cellVariants?: Record<string, 'success' | 'secondary'>
}

/** A house-favorite column: the favorite name plus how many occupants need it. */
export interface FavoriteColumn {
  favorite: string
  count: number
}

/**
 * House-favorite columns ordered by how many occupants need each favorite
 * (count descending), then alphabetically by `localeCompare` for deterministic
 * ties. Mirrors the original HouseRecord computed.
 */
export function houseFavoriteColumns(
  pokemon: string[],
  pokemonData: PokemonData,
): FavoriteColumn[] {
  const freq = new Map<string, number>()
  for (const name of pokemon) {
    for (const fav of pokemonData[name]?.favorites ?? []) {
      freq.set(fav, (freq.get(fav) ?? 0) + 1)
    }
  }
  return Array.from(freq.entries())
    .map(([favorite, count]) => ({ favorite, count }))
    .sort((a, b) => b.count - a.count || a.favorite.localeCompare(b.favorite))
}

export function craftabilityText(item: ItemDetails): string {
  return item.isCraftable ? (item.category ? `Craftable (${item.category})` : 'Craftable') : 'Buy'
}

export function buildRecommendationRow(
  itemData: ItemDetails,
  added: boolean,
  recOrder: number,
  itemFavs: string[],
  fulfilledSet: Set<string>,
  favoriteColumns: FavoriteColumn[],
  fulfilledTags: Set<string>,
): RecommendationRow {
  const row: RecommendationRow = {
    itemData,
    name: itemData.name,
    craftability: craftabilityText(itemData),
    added,
    recOrder,
    col_toy: itemData.tag === 'Toy',
    col_relaxation: itemData.tag === 'Relaxation',
    col_decoration: itemData.tag === 'Decoration',
  }
  const cellVariants: Record<string, 'success' | 'secondary'> = {}
  // Tag coverage: a non-placed (unadded) row whose tag is already fulfilled is
  // redundant — gray out that tag cell (like redundant favorite coverage) to
  // signal it is lower value, while added rows keep the success highlight.
  if (row.col_toy) {
    cellVariants['col_toy'] = !added && fulfilledTags.has('Toy') ? 'secondary' : 'success'
  }
  if (row.col_relaxation) {
    cellVariants['col_relaxation'] =
      !added && fulfilledTags.has('Relaxation') ? 'secondary' : 'success'
  }
  if (row.col_decoration) {
    cellVariants['col_decoration'] =
      !added && fulfilledTags.has('Decoration') ? 'secondary' : 'success'
  }
  const favSet = new Set(itemFavs)
  for (const col of favoriteColumns) {
    const cellKey = favoriteCoverageColumnKey(col.favorite)
    const isCovered = favSet.has(col.favorite)
    row[cellKey] = isCovered
    if (isCovered) {
      // A non-placed (unadded) row covering an already-fulfilled favorite is
      // redundant — gray out that coverage cell instead of the success highlight
      // to signal it is lower value than coverage of still-unfulfilled needs.
      if (!added && fulfilledSet.has(col.favorite)) {
        cellVariants[cellKey] = 'secondary'
      } else {
        cellVariants[cellKey] = 'success'
      }
    }
  }
  if (Object.keys(cellVariants).length > 0) {
    row._cellVariants = cellVariants
  }
  return row
}

export interface BuildRecommendationRowsInput {
  recommendations: ItemDetails[]
  // The house's cart items (satisfying ItemDetails) — used both to derive the
  // cart-name set and to emit added-only rows for cart items missing a base row.
  cartItems: ItemDetails[]
  favByItem: Map<string, string[]>
  fulfilledFavoriteSet: Set<string>
  favoriteColumns: FavoriteColumn[]
  fulfilledTags: Set<string>
}

/**
 * Lifts the row-assembly tail of HouseRecord's build watch: base rows for the
 * recommendations (added when their name is in the cart), then added-only rows
 * for cart items not already present as a base row. `recOrder` sequences base
 * rows in recommendation order and appends added-only rows after them.
 */
export function buildRecommendationRows({
  recommendations,
  cartItems,
  favByItem,
  fulfilledFavoriteSet,
  favoriteColumns,
  fulfilledTags,
}: BuildRecommendationRowsInput): RecommendationRow[] {
  const cartNames = cartItems.map((item) => item.name)
  const cartNameSet = new Set(cartNames)
  const baseNames = new Set(recommendations.map((rec) => rec.name))

  const baseRows = recommendations.map((rec, index) =>
    buildRecommendationRow(
      rec,
      cartNameSet.has(rec.name),
      index,
      favByItem.get(rec.name) ?? [],
      fulfilledFavoriteSet,
      favoriteColumns,
      fulfilledTags,
    ),
  )

  let order = recommendations.length
  const addedOnlyRows: RecommendationRow[] = []
  for (const item of cartItems) {
    if (baseNames.has(item.name)) continue
    addedOnlyRows.push(
      buildRecommendationRow(
        item,
        true,
        order++,
        favByItem.get(item.name) ?? [],
        fulfilledFavoriteSet,
        favoriteColumns,
        fulfilledTags,
      ),
    )
  }

  return [...baseRows, ...addedOnlyRows]
}

/**
 * Mirrors BTable's default comparator (string coercion + numeric-aware
 * localeCompare, inverted on desc), with `added` as the leading key so added
 * rows always sort above unadded ones and `recOrder` as the final tie-break
 * preserving recommendation relevance.
 */
export function compareRows(
  a: RecommendationRow,
  b: RecommendationRow,
  sortBy: BTableSortBy[],
): number {
  if (a.added !== b.added) return a.added ? -1 : 1
  for (const { key, order } of sortBy) {
    const c = String(a[key] ?? '').localeCompare(String(b[key] ?? ''), undefined, {
      numeric: true,
    })
    if (c !== 0) return order === 'desc' ? -c : c
  }
  return a.recOrder - b.recOrder
}

/**
 * Hover tooltip for a favorite-coverage ✓ cell. "Placed" here means the item is
 * in this house's cart (committed to this house): an in-cart item is actively
 * fulfilling the need, an unadded item could fulfill it, and an unadded item
 * covering an already-fulfilled need is redundant (grayed) — the same states
 * the cell backgrounds communicate.
 */
export function favoriteCellTitle(
  item: RecommendationRow,
  fieldKey: string,
  fulfilledFavorites: Set<string>,
): string | undefined {
  if (!fieldKey.startsWith('fav_')) return undefined
  const favorite = fieldKey.slice('fav_'.length)
  if (item.added) {
    return `${item.name} is fulfilling ${favorite}`
  }
  if (fulfilledFavorites.has(favorite)) {
    return `${item.name} would fulfill ${favorite}, but it is fulfilled by other items already placed in this house.`
  }
  return `${item.name} could fulfill ${favorite} if it were placed in this house`
}
