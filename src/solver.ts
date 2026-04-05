import { init } from 'z3-solver'
import { buildSubMatrix, clusterPreAssign, type AdjacencyData } from './heuristic'

export type { AdjacencyData }

// In the browser, Vite resolves 'z3-solver' to its browser build (browser.js),
// which reads globalThis.initZ3. The Emscripten pthreads require z3-built.js to
// be loaded as a classic <script> tag so document.currentScript?.src resolves
// correctly for the worker URL. The files are copied to public/ by postinstall.
function loadZ3Script(): Promise<void> {
  // In Node.js (vitest), z3-solver resolves to the node build which loads WASM
  // directly via require(). Only load the script tag in a real browser.
  if (
    (typeof process !== 'undefined' && process.versions?.node) ||
    (globalThis as Record<string, unknown>).initZ3
  ) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/z3-built.js'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load z3-built.js'))
    document.head.appendChild(script)
  })
}

export interface PokemonData {
  [name: string]: { image: string; favorites: string[] }
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

let z3Promise: ReturnType<typeof init> | null = null
function getZ3() {
  if (!z3Promise) {
    z3Promise = loadZ3Script().then(() => init())
  }
  return z3Promise
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

  // Greedy pre-assignment: collapse medium/large house slots before Z3
  let preAssignments = new Map<string, number>()
  if (adjacencyData) {
    const subMatrix = buildSubMatrix(pokemonNames, adjacencyData)
    preAssignments = clusterPreAssign(pokemonNames, houses, subMatrix)
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

  // Pre-assignment constraints: fix heuristically chosen pokemon to their houses
  for (let i = 0; i < n; i++) {
    const houseIdx = preAssignments.get(pokemonNames[i]!)
    if (houseIdx !== undefined) {
      optimizer.add(assignments[i]!.eq(houseIdx))
    }
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
  // Precompute favorites sets to avoid rebuilding per pair
  const favSets = new Map<string, Set<string>>()
  for (const name of pokemonNames) {
    const entry = pokemonData[name]
    if (entry) favSets.set(name, new Set(entry.favorites))
  }

  const pairTerms: ReturnType<typeof If>[] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const setA = favSets.get(pokemonNames[i]!)
      const entryB = pokemonData[pokemonNames[j]!]
      const shared = setA && entryB ? entryB.favorites.filter((f) => setA.has(f)).length : 0
      if (shared === 0) continue
      // Both assigned to the same house and neither is unhoused
      const sameHouse = assignments[i]!.eq(assignments[j]!).and(assignments[i]!.neq(0))
      pairTerms.push(If(sameHouse, Int.val(shared), Int.val(0)))
    }
  }

  if (pairTerms.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    optimizer.maximize(Sum(pairTerms[0]! as any, ...(pairTerms.slice(1) as any[])))
  }

  const result = await optimizer.check()
  if (result !== 'sat') {
    throw new Error(`Solver returned ${result}`)
  }

  const model = optimizer.model()

  // Extract assignments from model
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignmentValues = assignments.map((a) => Number((model.eval(a) as any).value()))

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
