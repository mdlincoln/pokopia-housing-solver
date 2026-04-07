import itemsByFavorite from '../public/items_by_favorite.json'

const catalog: Record<string, string[]> = itemsByFavorite

/**
 * Given a set of pokemon favorites for a household, returns a map of
 * item → number of input favorites that item fulfills.
 * Items that fulfill none of the input favorites are omitted.
 */
export function idealItems(favorites: Set<string>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const fav of favorites) {
    const items = catalog[fav]
    if (!items) continue
    for (const item of items) {
      counts.set(item, (counts.get(item) ?? 0) + 1)
    }
  }
  return counts
}
