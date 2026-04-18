import {
  solve,
  type AdjacencyMap,
  type HouseWithId,
  type PokemonData,
  type SolverResult,
} from '@/solver'
import SolverWorker from '@/solver.worker.ts?worker'
import type { SolverRequest, SolverResponse } from '@/solver.worker'
import { toRaw } from 'vue'

export class SupersededError extends Error {
  constructor() {
    super('solve superseded by a newer request')
    this.name = 'SupersededError'
  }
}

interface PendingSolve {
  resolve: (result: SolverResult) => void
  reject: (err: Error) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, PendingSolve>()

function getWorker(): Worker | null {
  if (worker) return worker
  // Web Workers aren't available in jsdom (unit tests). Fall back to
  // running solve() synchronously on the main thread in that case.
  if (typeof Worker === 'undefined') return null
  worker = new SolverWorker()
  worker.addEventListener('message', (event: MessageEvent<SolverResponse>) => {
    const response = event.data
    const entry = pending.get(response.id)
    if (!entry) return
    pending.delete(response.id)
    if (response.ok) {
      entry.resolve(response.result)
    } else {
      entry.reject(new Error(response.error))
    }
  })
  worker.addEventListener('error', (event) => {
    const err = new Error(event.message || 'solver worker error')
    for (const entry of pending.values()) entry.reject(err)
    pending.clear()
  })
  return worker
}

export interface SolveArgs {
  pokemonNames: string[]
  houses: HouseWithId[]
  pokemonData: PokemonData
  adjacencyMap?: AdjacencyMap
  pinnedAssignments?: Map<string, string[]>
}

/**
 * Runs solve() in a Web Worker. Any previously-pending request is rejected
 * with SupersededError — callers should swallow that rejection silently.
 */
export function solveInWorker(args: SolveArgs): Promise<SolverResult> {
  const w = getWorker()
  if (!w) {
    return solve(
      args.pokemonNames,
      args.houses,
      args.pokemonData,
      args.adjacencyMap,
      args.pinnedAssignments,
    )
  }

  for (const entry of pending.values()) entry.reject(new SupersededError())
  pending.clear()

  const id = nextId++
  return new Promise<SolverResult>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    // Vue reactive Proxies are not structured-clonable. toRaw() strips one
    // proxy layer, but pokemonData sub-objects become reactive when spread via
    // `{ ...pokemonData.value }` in HomeView, so a single toRaw isn't enough.
    // Build fully-plain copies of every reactive argument before postMessage.
    const rawPokemonData: PokemonData = {}
    for (const [name, entry] of Object.entries(toRaw(args.pokemonData))) {
      const e = toRaw(entry as { image: string; favorites: string[]; habitat?: string })
      rawPokemonData[name] = {
        image: e.image,
        favorites: [...toRaw(e.favorites)],
        habitat: e.habitat,
      }
    }

    const request: SolverRequest = {
      id,
      pokemonNames: [...toRaw(args.pokemonNames)],
      houses: args.houses.map((h) => ({ ...toRaw(h) })),
      pokemonData: rawPokemonData,
      adjacencyMap: args.adjacencyMap ? toRaw(args.adjacencyMap) : undefined,
      pinnedAssignments: args.pinnedAssignments,
    }
    w.postMessage(request)
  })
}
