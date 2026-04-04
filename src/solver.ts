import { init } from 'z3-solver'

export interface PokemonData {
  [name: string]: { image: string; favorites: string[] }
}

export interface HousingConfig {
  small: number
  medium: number
  large: number
}

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

const HOUSE_SIZES: Record<string, number> = {
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
    const capacity = HOUSE_SIZES[size]
    if (capacity === undefined) {
      throw new Error(`Unknown house size: ${size}`)
    }
    for (let i = 0; i < count; i++) {
      houses.push({ index: idx++, size, capacity })
    }
  }
  return houses
}

export function countSharedFavorites(
  nameA: string,
  nameB: string,
  data: PokemonData,
): number {
  const entryA = data[nameA]
  const entryB = data[nameB]
  if (!entryA || !entryB) return 0
  const setA = new Set(entryA.favorites)
  return entryB.favorites.filter((f) => setA.has(f)).length
}

let z3Promise: ReturnType<typeof init> | null = null
function getZ3() {
  if (!z3Promise) z3Promise = init()
  return z3Promise
}

export async function solve(
  pokemonNames: string[],
  housingConfig: HousingConfig,
  pokemonData: PokemonData,
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

  const { Context } = await getZ3()
  const ctx = new Context('pokemon')
  const { Optimize, Int, If, Sum } = ctx

  const optimizer = new Optimize()
  const n = pokemonNames.length

  // One integer variable per pokemon: 0 = unhoused, 1..numHouses = house index
  const assignments = pokemonNames.map((name, i) => Int.const(`p_${i}_${name}`))

  // Domain constraints: 0 <= assignment <= numHouses
  for (const a of assignments) {
    optimizer.add(a.ge(0))
    optimizer.add(a.le(numHouses))
  }

  // Capacity constraints: for each house, count of assigned pokemon <= capacity
  for (const house of houses) {
    const counts = assignments.map((a) => If(a.eq(house.index), Int.val(1), Int.val(0)))
    optimizer.add(Sum(counts[0]!, ...counts.slice(1)).le(house.capacity))
  }

  // Objective 1 (highest priority): minimize unhoused count
  const unhousedTerms = assignments.map((a) => If(a.eq(0), Int.val(1), Int.val(0)))
  optimizer.minimize(Sum(unhousedTerms[0]!, ...unhousedTerms.slice(1)))

  // Objective 2: maximize shared favorites between housemates
  // Precompute shared favorite counts and build pair bonus terms
  const pairTerms: ReturnType<typeof If>[] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const shared = countSharedFavorites(pokemonNames[i]!, pokemonNames[j]!, pokemonData)
      if (shared === 0) continue
      // Both assigned to the same house and neither is unhoused
      const sameHouse = assignments[i]!.eq(assignments[j]!).and(assignments[i]!.neq(0))
      pairTerms.push(If(sameHouse, Int.val(shared), Int.val(0)))
    }
  }

  if (pairTerms.length > 0) {
    optimizer.maximize(Sum(pairTerms[0]!, ...pairTerms.slice(1)))
  }

  const result = await optimizer.check()
  if (result !== 'sat') {
    throw new Error(`Solver returned ${result}`)
  }

  const model = optimizer.model()

  // Extract assignments from model
  const assignmentValues = assignments.map((a) => Number(model.eval(a).value()))

  // Build result
  const houseMap = new Map<number, string[]>()
  const unhoused: string[] = []

  for (let i = 0; i < n; i++) {
    const houseIdx = assignmentValues[i]!
    if (houseIdx === 0) {
      unhoused.push(pokemonNames[i]!)
    } else {
      if (!houseMap.has(houseIdx)) houseMap.set(houseIdx, [])
      houseMap.get(houseIdx)!.push(pokemonNames[i]!)
    }
  }

  const houseAssignments: HouseAssignment[] = houses.map((h) => ({
    houseIndex: h.index,
    size: h.size,
    capacity: h.capacity,
    pokemon: houseMap.get(h.index) ?? [],
  }))

  return { houses: houseAssignments, unhoused }
}
