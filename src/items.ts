import itemsByFavorite from '../public/items_by_favorite.json'

const catalog: Record<string, string[]> = itemsByFavorite

// Case-insensitive lookup: normalize catalog keys to lowercase
const catalogByLower = new Map<string, string[]>()
for (const [key, items] of Object.entries(catalog)) {
  catalogByLower.set(key.toLowerCase(), items)
}

export interface ItemScore {
  item: string
  score: number
}

/**
 * Given a list of pokemon favorites for a household, returns an array of
 * items with the number of input favorites each item fulfills.
 * Duplicate favorites in the input count each fulfilling item again,
 * so items satisfying a repeated favorite score higher.
 * Items that fulfill none of the input favorites are omitted.
 */
export function idealItems(favorites: string[]): ItemScore[] {
  const counts = new Map<string, number>()
  for (const fav of favorites) {
    const items = catalogByLower.get(fav.toLowerCase())
    if (!items) continue
    for (const item of items) {
      counts.set(item, (counts.get(item) ?? 0) + 1)
    }
  }
  return Array.from(counts, ([item, score]) => ({ item, score }))
}

export interface FavoriteCount {
  favorite: string
  count: number
}

/**
 * Expands a favorite/count array into a repeated favorites list,
 * then delegates to idealItems to score items.
 */
export function favoritesToItems(favoriteCounts: FavoriteCount[]): ItemScore[] {
  const favorites: string[] = []
  for (const { favorite, count } of favoriteCounts) {
    for (let i = 0; i < count; i++) {
      favorites.push(favorite)
    }
  }
  return idealItems(favorites)
}
