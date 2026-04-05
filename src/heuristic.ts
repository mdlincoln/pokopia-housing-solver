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
