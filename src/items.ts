import {
  idealItems,
  itemsForFavorite,
  taggedItemsForHouseFavorites,
  type ItemDetails,
} from '@/queries'

export type { ItemDetails, ItemScore, TaggedItemResult } from '@/queries'
export {
  favoritesForItem,
  idealItems,
  itemsForFavorite,
  taggedItemsForHouseFavorites,
} from '@/queries'

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
  // Deduplicate input favorites (case-insensitive)
  const uniqueFavs: string[] = []
  const seen = new Set<string>()
  for (const fav of favorites) {
    const lower = fav.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      uniqueFavs.push(lower)
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

// @lat: [[items#clusterTaggedItemsForHouse]]
export async function clusterTaggedItemsForHouse(allFavorites: string[]): Promise<ItemCluster[]> {
  const normalized = allFavorites.map((f) => f.toLowerCase())

  // Count occurrences of each favorite (duplicates = multiple pokemon share it)
  const favCounts = new Map<string, number>()
  for (const fav of normalized) {
    favCounts.set(fav, (favCounts.get(fav) ?? 0) + 1)
  }

  const items = await taggedItemsForHouseFavorites(normalized)

  // Group items by their sorted covered-favorites key
  const groups = new Map<string, ItemCluster>()
  for (const item of items) {
    const key = item.coveredFavorites.join('\0')
    let group = groups.get(key)
    if (!group) {
      group = { favorites: item.coveredFavorites, items: [] }
      groups.set(key, group)
    }
    group.items.push(item)
  }

  // Score a cluster by summing pokemon-favorite match counts across its covered favorites
  function clusterScore(cluster: ItemCluster): number {
    return cluster.favorites.reduce((sum, fav) => sum + (favCounts.get(fav) ?? 0), 0)
  }

  // Sort items within each cluster alphabetically
  for (const cluster of groups.values()) {
    cluster.items.sort((a, b) => a.name.localeCompare(b.name))
  }

  // Sort clusters: score desc → favorites.length desc → alphabetical key
  return Array.from(groups.values()).sort((a, b) => {
    const scoreDiff = clusterScore(b) - clusterScore(a)
    if (scoreDiff !== 0) return scoreDiff
    const lenDiff = b.favorites.length - a.favorites.length
    if (lenDiff !== 0) return lenDiff
    return a.favorites.join('\0').localeCompare(b.favorites.join('\0'))
  })
}
