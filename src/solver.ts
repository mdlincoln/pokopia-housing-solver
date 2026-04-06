/**
 * Pokemon housing solver — assigns pokemon to houses maximizing shared favorites.
 *
 * The assignment pipeline has three phases, each targeting a house-size tier:
 *
 *   1. buildSubMatrix    — extracts a small N×N compatibility matrix for the
 *                          selected pokemon from the full precomputed adjacency data.
 *   2. clusterPreAssign  — orchestrates phases 1 and 2 below on that sub-matrix:
 *      a. agglomerativeCluster4  — groups tightly-connected pokemon into size-4
 *                                  clusters for large houses (average-linkage HAC).
 *      b. greedyMaxWeightMatching — pairs remaining pokemon by highest edge weight
 *                                   for medium houses (greedy matching).
 *   3. greedyFillRemaining — assigns any still-unassigned pokemon one at a time,
 *                            picking the best (pokemon, house) pair by total affinity
 *                            with current occupants. Also handles the no-adjacency
 *                            fallback path using raw shared-favorites counts.
 *
 * Phases 1–2 only run when precomputed adjacencyData is provided; phase 3 always runs.
 * Small houses (capacity 1) are never pre-assigned — they are filled in phase 3.
 */

export interface AdjacencyData {
  pokemon: string[]
  matrix: number[][]
}

/**
 * Phase 0: Extract an N×N sub-matrix for the selected pokemon from the full
 * adjacency data. This converts the global pokemon-index space into a local
 * index space that the clustering functions operate on.
 *
 * subMatrix[i][j] = adjacency score between pokemonNames[i] and pokemonNames[j].
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
 * Phase 1: Size-constrained agglomerative clustering for large houses (capacity 4).
 *
 * Called by clusterPreAssign to fill large houses. Uses hierarchical
 * agglomerative clustering (HAC) with average-linkage and a size cap of 4.
 *
 * Algorithm:
 *   1. Each pokemon starts as a singleton cluster.
 *   2. Repeatedly merge the highest average-linkage pair where merged size ≤ 4.
 *   3. Clusters that reach size 4 are frozen as candidates.
 *   4. Return the top `count` candidates ranked by total internal pairwise weight.
 *
 * The available set is not mutated — callers track which indices are consumed.
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
 * Phase 2: Greedy maximum-weight matching for medium houses (capacity 2).
 *
 * Called by clusterPreAssign after agglomerativeCluster4 has consumed the
 * most tightly-connected groups. Operates on the remaining available indices.
 *
 * Algorithm:
 *   1. Collect all weighted edges between available nodes.
 *   2. Sort edges by weight descending.
 *   3. Greedily pick edges where both endpoints are still unmatched.
 *
 * Returns up to `count` non-overlapping pairs.
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
 * Orchestrator for phases 1 and 2 of the clustering pre-assignment.
 *
 * Separates houses by size, then:
 *   Phase 1 — fills large houses (capacity 4) via agglomerativeCluster4.
 *   Phase 2 — fills medium houses (capacity 2) via greedyMaxWeightMatching
 *             on the pokemon remaining after phase 1.
 *
 * Small houses (capacity 1) are deliberately skipped — they gain nothing
 * from clustering and are filled during the greedy tail phase.
 *
 * Returns a Map from pokemon name → house index for all pre-assigned pokemon.
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

export interface PokemonData {
  [name: string]: { image: string; favorites: string[]; habitat?: string }
}

export type HousingConfig = Record<HouseSize, number>

export interface HouseAssignment {
  houseIndex: number
  size: string
  capacity: number
  pokemon: string[]
}

export interface SolverResult {
  houses: HouseAssignment[]
  unhoused: string[]
}

export type HouseSize = 'small' | 'medium' | 'large'

const HOUSE_SIZES: Record<HouseSize, number> = {
  small: 1,
  medium: 2,
  large: 4,
}

export interface EnumeratedHouse {
  index: number
  size: string
  capacity: number
}

export function enumerateHouses(config: HousingConfig): EnumeratedHouse[] {
  const houses: EnumeratedHouse[] = []
  let idx = 1
  for (const [size, count] of Object.entries(config)) {
    const capacity = HOUSE_SIZES[size as HouseSize]
    if (capacity === undefined) {
      throw new Error(`Unknown house size: ${size}`)
    }
    for (let i = 0; i < count; i++) {
      houses.push({ index: idx++, size, capacity })
    }
  }
  return houses
}

export function rankHouseFavorites(
  favoriteSets: Set<string>[],
): Array<{ favorite: string; count: number }> {
  const freq = new Map<string, number>()
  for (const set of favoriteSets) {
    for (const fav of set) {
      freq.set(fav, (freq.get(fav) ?? 0) + 1)
    }
  }
  return Array.from(freq.entries())
    .filter(([, count]) => count >= 2)
    .map(([favorite, count]) => ({ favorite, count }))
    .sort((a, b) => b.count - a.count)
}

export function countSharedFavorites(nameA: string, nameB: string, data: PokemonData): number {
  const entryA = data[nameA]
  const entryB = data[nameB]
  if (!entryA || !entryB) return 0
  const setA = new Set(entryA.favorites)
  return entryB.favorites.filter((f) => setA.has(f)).length
}

// @lat: [[lat.md/solver#Solver#Clustering Pre-assignment#greedyFillRemaining]]
/**
 * Phase 3: Greedy best-fit assignment for all remaining unassigned pokemon.
 *
 * Runs after clusterPreAssign (or as the sole assigner when no adjacencyData
 * is provided). Iterates until every pokemon is placed or no capacity remains:
 *
 *   1. Score every (pokemon, house) pair by total affinity with current occupants.
 *   2. Pick the highest-scoring pair; break ties by largest remaining capacity.
 *   3. Assign the pokemon and update occupants/capacity.
 *
 * When adjacencyData is available, uses precomputed scores (including habitat
 * bonuses) and rejects any house where an existing occupant has a negative
 * adjacency score with the candidate (hard incompatibility). Without
 * adjacencyData, falls back to counting raw shared favorites on the fly.
 */
function greedyFillRemaining(
  remaining: string[],
  occupants: Map<number, string[]>,
  remainingCapacity: Map<number, number>,
  pokemonData: PokemonData,
  adjacencyData?: AdjacencyData,
): Map<string, number> {
  const result = new Map<string, number>()
  const pool = new Set(remaining)

  const nameToIdx = adjacencyData
    ? new Map(adjacencyData.pokemon.map((name, i) => [name, i]))
    : null

  while (pool.size > 0) {
    let bestScore = -1
    let bestPokemon = ''
    let bestHouse = -1
    let bestHouseCapacity = -1

    for (const name of pool) {
      const fullI = nameToIdx?.get(name)
      for (const [houseIdx, cap] of remainingCapacity) {
        if (cap <= 0) continue
        let score = 0
        let incompatible = false
        for (const occupant of occupants.get(houseIdx) ?? []) {
          if (adjacencyData && fullI !== undefined) {
            const fullJ = nameToIdx!.get(occupant)
            const val = fullJ !== undefined ? (adjacencyData.matrix[fullI]![fullJ] ?? 0) : 0
            if (val < 0) {
              incompatible = true
              break
            }
            score += val
          } else {
            score += countSharedFavorites(name, occupant, pokemonData)
          }
        }
        if (incompatible) continue
        // Prefer higher score; break ties by larger remaining capacity
        if (score > bestScore || (score === bestScore && cap > bestHouseCapacity)) {
          bestScore = score
          bestPokemon = name
          bestHouse = houseIdx
          bestHouseCapacity = cap
        }
      }
    }

    if (bestHouse === -1) break // No capacity remaining anywhere

    result.set(bestPokemon, bestHouse)
    pool.delete(bestPokemon)
    occupants.get(bestHouse)!.push(bestPokemon)
    remainingCapacity.set(bestHouse, remainingCapacity.get(bestHouse)! - 1)
    if (remainingCapacity.get(bestHouse) === 0) {
      remainingCapacity.delete(bestHouse)
    }
  }

  return result
}

export async function solve(
  pokemonNames: string[],
  housingConfig: HousingConfig,
  pokemonData: PokemonData,
  adjacencyData?: AdjacencyData,
): Promise<SolverResult> {
  const houses = enumerateHouses(housingConfig)
  const numHouses = houses.length

  // Validate pokemon names
  for (const name of pokemonNames) {
    if (!pokemonData[name]) {
      throw new Error(`Unknown pokemon: ${name}`)
    }
  }

  // Trivial: no pokemon
  if (pokemonNames.length === 0) {
    return {
      houses: houses.map((h) => ({ ...h, houseIndex: h.index, pokemon: [] })),
      unhoused: [],
    }
  }

  // Trivial: no houses
  if (numHouses === 0) {
    return { houses: [], unhoused: [...pokemonNames] }
  }

  // Phase 1+2: Cluster-based pre-assignment for large and medium houses
  let preAssignments = new Map<string, number>()
  if (adjacencyData) {
    const subMatrix = buildSubMatrix(pokemonNames, adjacencyData)
    preAssignments = clusterPreAssign(pokemonNames, houses, subMatrix)
  }

  // Build occupants and remaining capacity from pre-assignments
  const occupants = new Map<number, string[]>()
  const remainingCapacity = new Map<number, number>()
  for (const house of houses) {
    occupants.set(house.index, [])
    remainingCapacity.set(house.index, house.capacity)
  }
  for (const [name, houseIdx] of preAssignments) {
    occupants.get(houseIdx)!.push(name)
    remainingCapacity.set(houseIdx, remainingCapacity.get(houseIdx)! - 1)
    if (remainingCapacity.get(houseIdx) === 0) {
      remainingCapacity.delete(houseIdx)
    }
  }

  // Phase 3: Greedily fill remaining slots with unassigned pokemon
  const assigned = new Set(preAssignments.keys())
  const remaining = pokemonNames.filter((name) => !assigned.has(name))
  const tailAssignments = greedyFillRemaining(
    remaining,
    occupants,
    remainingCapacity,
    pokemonData,
    adjacencyData,
  )

  // Merge all assignments
  const allAssignments = new Map([...preAssignments, ...tailAssignments])
  const unhoused = pokemonNames.filter((name) => !allAssignments.has(name))

  const houseAssignments: HouseAssignment[] = houses.map((h) => ({
    houseIndex: h.index,
    size: h.size,
    capacity: h.capacity,
    pokemon: occupants.get(h.index) ?? [],
  }))

  return { houses: houseAssignments, unhoused }
}
