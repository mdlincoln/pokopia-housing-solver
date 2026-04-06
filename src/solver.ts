import { buildSubMatrix, clusterPreAssign, type AdjacencyData } from './heuristic'

export type { AdjacencyData }

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
 * Greedy best-fit assignment for the remaining unassigned pokemon.
 *
 * Repeatedly picks the (pokemon, house) pair with the highest total shared
 * favorites between the pokemon and the house's current occupants, then
 * assigns it. Ties (including zero-score pairs) are broken by assigning to the
 * house with the most remaining capacity. Pokemon that cannot be placed (no
 * remaining capacity anywhere) are returned as unhoused.
 *
 * When adjacencyData is provided, uses precomputed scores (which include
 * habitat bonuses/penalties) and skips any house where an existing occupant
 * has a negative adjacency score with the candidate (hard incompatibility).
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
