import { idealItems, itemsForFavorite } from '@/queries'

export type { ItemScore } from '@/queries'
export { favoritesForItem, idealItems, itemsForFavorite } from '@/queries'

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
  items: string[]
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

  // For each item, collect which input favorites it fulfills
  const itemFavs = new Map<string, string[]>()
  for (const fav of uniqueFavs) {
    const items = await itemsForFavorite(fav)
    for (const itemName of items) {
      let list = itemFavs.get(itemName)
      if (!list) {
        list = []
        itemFavs.set(itemName, list)
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

  // Rank by number of favorites covered (descending), then alphabetically by cluster key
  return Array.from(groups.values()).sort(compareClusters)
}

// @lat: [[items#selectTopNonOverlappingClusters]]
export async function selectTopNonOverlappingClusters(
  clusters: ItemCluster[],
  limit = 3,
): Promise<ItemCluster[]> {
  const sorted = [...clusters].sort(compareClusters)
  let best: ItemCluster[] = []
  let bestCoverage = -1
  let bestSignature = ''

  function evaluateSelection(selection: ItemCluster[]) {
    const coverage = selection.reduce((sum, cluster) => sum + cluster.favorites.length, 0)
    const signature = selection.map(clusterKey).join('||')
    if (coverage > bestCoverage) {
      bestCoverage = coverage
      best = [...selection]
      bestSignature = signature
      return
    }
    if (coverage < bestCoverage) return
    if (selection.length > best.length) {
      best = [...selection]
      bestSignature = signature
      return
    }
    if (selection.length < best.length) return
    if (signature.localeCompare(bestSignature) < 0) {
      best = [...selection]
      bestSignature = signature
    }
  }

  function walk(index: number, selection: ItemCluster[], usedFavorites: Set<string>) {
    if (selection.length === limit || index === sorted.length) {
      evaluateSelection(selection)
      return
    }

    walk(index + 1, selection, usedFavorites)

    const candidate = sorted[index]!
    const normalized = candidate.favorites.map((favorite) => favorite.toLowerCase())
    if (normalized.some((favorite) => usedFavorites.has(favorite))) {
      return
    }

    for (const favorite of normalized) usedFavorites.add(favorite)
    selection.push(candidate)
    walk(index + 1, selection, usedFavorites)
    selection.pop()
    for (const favorite of normalized) usedFavorites.delete(favorite)
  }

  walk(0, [], new Set<string>())
  return best
}
