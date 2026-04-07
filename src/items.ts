import itemsByFavorite from '../src/items_by_favorite.json'

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

function clusterKey(cluster: ItemCluster): string {
  return [...cluster.favorites].sort((a, b) => a.localeCompare(b)).join('\0')
}

function compareClusters(a: ItemCluster, b: ItemCluster): number {
  const coverageDiff = b.favorites.length - a.favorites.length
  if (coverageDiff !== 0) return coverageDiff
  return clusterKey(a).localeCompare(clusterKey(b))
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

  // Rank by number of favorites covered (descending), then alphabetically by cluster key
  return Array.from(groups.values()).sort(compareClusters)
}

/**
 * Selects up to `limit` clusters with pairwise disjoint favorites while maximizing
 * total covered favorites. Uses deterministic tie-breakers for stable output.
 */
export function selectTopNonOverlappingClusters(clusters: ItemCluster[], limit = 3): ItemCluster[] {
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
