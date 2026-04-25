import {
  favoriteCoverageColumnKey,
  idealItems,
  itemsForFavorite,
  recommendedItemsForHouse,
  type ItemDetails,
} from '@/queries'

export {
  favoriteCoverageColumnKey,
  favoritesForItem,
  idealItems,
  itemsForFavorite,
  recommendedItemsForHouse,
} from '@/queries'
export type { ItemDetails, ItemScore, RecommendedHouseItem } from '@/queries'

export interface FavoriteCount {
  favorite: string
  count: number
}

/**
 * Expands a favorite/count array into a repeated favorites list,
 * then delegates to idealItems to score items.
 */
export async function favoritesToItems(
  favoriteCounts: FavoriteCount[],
): Promise<import('@/queries').ItemScore[]> {
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
  items: ItemDetails[]
}

function clusterKey(cluster: ItemCluster): string {
  return [...cluster.favorites].sort((a, b) => a.localeCompare(b)).join('\0')
}

function compareClusters(a: ItemCluster, b: ItemCluster): number {
  const coverageDiff = b.favorites.length - a.favorites.length
  if (coverageDiff !== 0) return coverageDiff
  return clusterKey(a).localeCompare(clusterKey(b))
}

// @lat: [[items#clusterItemsByFavorites]]
export async function clusterItemsByFavorites(favorites: string[]): Promise<ItemCluster[]> {
  // Deduplicate input favorites
  const uniqueFavs: string[] = []
  const seen = new Set<string>()
  for (const fav of favorites) {
    if (!seen.has(fav)) {
      seen.add(fav)
      uniqueFavs.push(fav)
    }
  }

  // For each item, collect which input favorites it fulfills (keeping full ItemDetails)
  const itemFavs = new Map<string, { details: ItemDetails; favs: string[] }>()
  for (const fav of uniqueFavs) {
    const items = await itemsForFavorite(fav)
    for (const detail of items) {
      let entry = itemFavs.get(detail.name)
      if (!entry) {
        entry = { details: detail, favs: [] }
        itemFavs.set(detail.name, entry)
      }
      entry.favs.push(fav)
    }
  }

  // Group items by their sorted favorites key
  const groups = new Map<string, { favorites: string[]; items: ItemDetails[] }>()
  for (const [, { details, favs }] of itemFavs) {
    const sorted = [...favs].sort()
    const key = sorted.join('\0')
    let group = groups.get(key)
    if (!group) {
      group = { favorites: sorted, items: [] }
      groups.set(key, group)
    }
    group.items.push(details)
  }

  // Rank by number of favorites covered (descending), then alphabetically by cluster key
  return Array.from(groups.values()).sort(compareClusters)
}
