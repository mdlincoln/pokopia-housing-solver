import type { EnumeratedHouse } from './solver'

export interface AdjacencyData {
  pokemon: string[]
  matrix: number[][]
}

/**
 * Extracts an N×N sub-matrix for the given pokemon names from the full adjacency data.
 * subMatrix[i][j] = shared favorites between pokemonNames[i] and pokemonNames[j].
 * Pokemon not found in adjacency data get 0 for all their connections.
 */
export function buildSubMatrix(pokemonNames: string[], adjacency: AdjacencyData): number[][] {
  const nameToIdx = new Map(adjacency.pokemon.map((name, i) => [name, i]))
  const n = pokemonNames.length
  const matrix: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0))

  for (let i = 0; i < n; i++) {
    const fullI = nameToIdx.get(pokemonNames[i]!)
    if (fullI === undefined) continue
    for (let j = i + 1; j < n; j++) {
      const fullJ = nameToIdx.get(pokemonNames[j]!)
      if (fullJ === undefined) continue
      const val = adjacency.matrix[fullI]![fullJ] ?? 0
      matrix[i]![j] = val
      matrix[j]![i] = val
    }
  }
  return matrix
}

/**
 * Greedy pre-assignment heuristic for medium and large houses.
 *
 * For each medium/large house in order:
 *   1. Pick the anchor: unassigned pokemon with the highest average shared
 *      favorites across all other unassigned pokemon.
 *   2. Pick the neighbor: unassigned pokemon with the most shared favorites
 *      with the anchor.
 *   3. Assign both to the house.
 *
 * Returns a Map from pokemon name to house index for pre-assigned pokemon.
 * Small houses (capacity 1) are skipped; they are left for Z3.
 */
export function greedyPreAssign(
  pokemonNames: string[],
  houses: EnumeratedHouse[],
  subMatrix: number[][],
): Map<string, number> {
  const available = new Set(pokemonNames.map((_, i) => i))
  const result = new Map<string, number>()

  for (const house of houses) {
    if (house.capacity < 2) continue
    if (available.size < 2) break

    // Anchor: highest average shared favorites with all other available pokemon
    let anchorIdx = -1
    let bestAvg = -1
    for (const i of available) {
      let total = 0
      let count = 0
      for (const j of available) {
        if (i === j) continue
        total += subMatrix[i]![j] ?? 0
        count++
      }
      const avg = count > 0 ? total / count : 0
      if (avg > bestAvg) {
        bestAvg = avg
        anchorIdx = i
      }
    }

    available.delete(anchorIdx)

    // Neighbor: highest shared favorites with the anchor
    let neighborIdx = -1
    let bestShared = -1
    for (const j of available) {
      const shared = subMatrix[anchorIdx]![j] ?? 0
      if (shared > bestShared) {
        bestShared = shared
        neighborIdx = j
      }
    }

    available.delete(neighborIdx)

    result.set(pokemonNames[anchorIdx]!, house.index)
    result.set(pokemonNames[neighborIdx]!, house.index)
  }

  return result
}

/**
 * Size-constrained agglomerative clustering for large houses (capacity 4).
 *
 * Starts with each pokemon as a singleton cluster. Repeatedly merges the
 * highest average-linkage pair of clusters, subject to merged size <= 4.
 * Clusters that reach size 4 are frozen as candidates. Returns the top
 * `count` candidates ranked by total internal pairwise weight.
 */
export function agglomerativeCluster4(
  available: Set<number>,
  subMatrix: number[][],
  count: number,
): number[][] {
  if (count === 0 || available.size < 4) return []

  // Initialize: each available node is its own cluster
  let nextId = 0
  const clusters = new Map<number, number[]>()
  for (const idx of available) {
    clusters.set(nextId++, [idx])
  }

  // Precompute average-linkage distances between all cluster pairs
  // avgLink[idA][idB] = sum of weights between members / (|A| * |B|)
  const avgLink = new Map<number, Map<number, number>>()
  for (const [idA, membersA] of clusters) {
    const row = new Map<number, number>()
    for (const [idB, membersB] of clusters) {
      if (idA >= idB) continue
      let total = 0
      for (const a of membersA) {
        for (const b of membersB) {
          total += subMatrix[a]![b] ?? 0
        }
      }
      row.set(idB, total / (membersA.length * membersB.length))
    }
    avgLink.set(idA, row)
  }

  const frozen: number[][] = []

  // Merge loop
  while (clusters.size > 1) {
    // Find the best merge (highest avg linkage) where merged size <= 4
    let bestScore = -1
    let bestA = -1
    let bestB = -1
    for (const [idA, row] of avgLink) {
      if (!clusters.has(idA)) continue
      for (const [idB, score] of row) {
        if (!clusters.has(idB)) continue
        const sizeA = clusters.get(idA)!.length
        const sizeB = clusters.get(idB)!.length
        if (sizeA + sizeB > 4) continue
        if (score > bestScore) {
          bestScore = score
          bestA = idA
          bestB = idB
        }
      }
    }

    if (bestA === -1) break // No valid merges left

    // Merge bestB into bestA
    const membersA = clusters.get(bestA)!
    const membersB = clusters.get(bestB)!
    const merged = [...membersA, ...membersB]
    clusters.delete(bestB)
    clusters.set(bestA, merged)

    // Remove bestB from avgLink
    avgLink.delete(bestB)
    for (const row of avgLink.values()) {
      row.delete(bestB)
    }

    // If merged cluster is size 4, freeze it
    if (merged.length === 4) {
      frozen.push(merged)
      clusters.delete(bestA)
      avgLink.delete(bestA)
      for (const row of avgLink.values()) {
        row.delete(bestA)
      }
      if (frozen.length >= count) break
      continue
    }

    // Update avg linkage between merged cluster and all remaining clusters
    for (const [idC, membersC] of clusters) {
      if (idC === bestA) continue
      let total = 0
      for (const a of merged) {
        for (const c of membersC) {
          total += subMatrix[a]![c] ?? 0
        }
      }
      const score = total / (merged.length * membersC.length)
      // Store in canonical order (lower id first)
      const lo = Math.min(bestA, idC)
      const hi = Math.max(bestA, idC)
      if (!avgLink.has(lo)) avgLink.set(lo, new Map())
      avgLink.get(lo)!.set(hi, score)
    }
  }

  // Rank frozen clusters by total internal pairwise weight
  const scored = frozen.map((members) => {
    let total = 0
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        total += subMatrix[members[i]!]![members[j]!] ?? 0
      }
    }
    return { members, score: total }
  })
  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, count).map((s) => s.members)
}

/**
 * Greedy maximum weight matching for medium houses (capacity 2).
 *
 * Collects all edges between available nodes, sorts by weight descending,
 * and greedily picks edges where both endpoints are unmatched.
 * Returns up to `count` pairs.
 */
export function greedyMaxWeightMatching(
  available: Set<number>,
  subMatrix: number[][],
  count: number,
): number[][] {
  if (count === 0 || available.size < 2) return []

  // Collect all weighted edges
  const edges: { i: number; j: number; w: number }[] = []
  const avail = [...available]
  for (let a = 0; a < avail.length; a++) {
    for (let b = a + 1; b < avail.length; b++) {
      const w = subMatrix[avail[a]!]![avail[b]!] ?? 0
      if (w > 0) edges.push({ i: avail[a]!, j: avail[b]!, w })
    }
  }

  // Sort descending by weight
  edges.sort((a, b) => b.w - a.w)

  const matched = new Set<number>()
  const pairs: number[][] = []

  for (const { i, j } of edges) {
    if (pairs.length >= count) break
    if (matched.has(i) || matched.has(j)) continue
    matched.add(i)
    matched.add(j)
    pairs.push([i, j])
  }

  return pairs
}

/**
 * Two-phase clustering pre-assignment for medium and large houses.
 *
 * Phase 1: Agglomerative clustering fills large houses (capacity 4).
 * Phase 2: Greedy max-weight matching fills medium houses (capacity 2).
 * Small houses and remaining pokemon are left for Z3.
 */
export function clusterPreAssign(
  pokemonNames: string[],
  houses: EnumeratedHouse[],
  subMatrix: number[][],
): Map<string, number> {
  const available = new Set(pokemonNames.map((_, i) => i))
  const result = new Map<string, number>()

  // Separate houses by size
  const largeHouses = houses.filter((h) => h.capacity >= 4)
  const mediumHouses = houses.filter((h) => h.capacity >= 2 && h.capacity < 4)

  // Phase 1: Fill large houses with size-4 clusters
  if (largeHouses.length > 0) {
    const clusters = agglomerativeCluster4(available, subMatrix, largeHouses.length)
    for (let c = 0; c < clusters.length; c++) {
      const house = largeHouses[c]!
      for (const idx of clusters[c]!) {
        result.set(pokemonNames[idx]!, house.index)
        available.delete(idx)
      }
    }
  }

  // Phase 2: Fill medium houses with matched pairs
  if (mediumHouses.length > 0) {
    const pairs = greedyMaxWeightMatching(available, subMatrix, mediumHouses.length)
    for (let p = 0; p < pairs.length; p++) {
      const house = mediumHouses[p]!
      for (const idx of pairs[p]!) {
        result.set(pokemonNames[idx]!, house.index)
        available.delete(idx)
      }
    }
  }

  return result
}
