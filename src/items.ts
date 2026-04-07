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

export interface ItemCluster {
  favorites: string[]
  items: string[]
}

/**
 * Groups items by the exact set of input favorites they fulfill.
 *
 * For each item that appears in at least one input favorite's catalog entry,
 * collects which of the input favorites it satisfies. Items sharing the same
 * set of fulfilled favorites are clustered together as interchangeable.
 * Clusters are ranked by number of favorites covered (descending).
 */
export function clusterItemsByFavorites(favorites: string[]): ItemCluster[] {
  // Deduplicate input favorites (case-insensitive)
  const uniqueFavs: string[] = []
  const seen = new Set<string>()
  for (const fav of favorites) {
    const lower = fav.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      uniqueFavs.push(fav)
    }
  }

  // For each item, collect which input favorites it fulfills
  const itemFavs = new Map<string, string[]>()
  for (const fav of uniqueFavs) {
    const items = catalogByLower.get(fav.toLowerCase())
    if (!items) continue
    for (const item of items) {
      let list = itemFavs.get(item)
      if (!list) {
        list = []
        itemFavs.set(item, list)
      }
      list.push(fav)
    }
  }

  // Group items by their sorted favorites key
  const groups = new Map<string, { favorites: string[]; items: string[] }>()
  for (const [item, favs] of itemFavs) {
    const sorted = [...favs].sort()
    const key = sorted.join('\0')
    let group = groups.get(key)
    if (!group) {
      group = { favorites: sorted, items: [] }
      groups.set(key, group)
    }
    group.items.push(item)
  }

  // Rank by number of favorites covered (descending)
  return Array.from(groups.values()).sort((a, b) => b.favorites.length - a.favorites.length)
}
