import {
  solve,
  type AdjacencyMap,
  type HouseWithId,
  type PokemonData,
  type SolverResult,
} from '@/solver'

export interface SolverRequest {
  id: number
  pokemonNames: string[]
  houses: HouseWithId[]
  pokemonData: PokemonData
  adjacencyMap?: AdjacencyMap
  pinnedAssignments?: Map<string, string[]>
}

export type SolverResponse =
  | { id: number; ok: true; result: SolverResult }
  | { id: number; ok: false; error: string }

self.addEventListener('message', async (event: MessageEvent<SolverRequest>) => {
  const req = event.data
  try {
    const result = await solve(
      req.pokemonNames,
      req.houses,
      req.pokemonData,
      req.adjacencyMap,
      req.pinnedAssignments,
    )
    const response: SolverResponse = { id: req.id, ok: true, result }
    ;(self as unknown as Worker).postMessage(response)
  } catch (e) {
    const response: SolverResponse = {
      id: req.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
    ;(self as unknown as Worker).postMessage(response)
  }
})
