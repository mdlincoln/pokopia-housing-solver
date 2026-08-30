// Reactive solve pipeline for HomeView. Owns `result`/`solving`, the worker
// dispatch (with SupersededError swallowing and the auto-sort flip-off late
// guards), and the solve watch's clamp/reconcile/gate logic. `displayedHouses`
// and its friends stay in HomeView (cross-cutting multi-store computeds).

import { type AdjacencyData, type PokemonData, type SolverResult } from '@/solver'
import { SupersededError, solveInWorker } from '@/solverClient'
import { useHouseStore } from '@/stores/houses'
import { usePinStore } from '@/stores/pins'
import { debounce } from '@/utils/debounce'
import { ref, watch, type ComputedRef, type Ref } from 'vue'

interface UseSolverPipelineOptions {
  selectedPokemon: Ref<string[]>
  small: Ref<number>
  medium: Ref<number>
  large: Ref<number>
  autoSort: Ref<boolean>
  hydratedPokemonReady: ComputedRef<boolean>
  adjacencyData: Ref<AdjacencyData | null>
  pokemonData: Ref<PokemonData>
  minSmall: ComputedRef<number>
  minMedium: ComputedRef<number>
  minLarge: ComputedRef<number>
  totalHouses: ComputedRef<number>
  error: Ref<string>
}

export function useSolverPipeline({
  selectedPokemon,
  small,
  medium,
  large,
  autoSort,
  hydratedPokemonReady,
  adjacencyData,
  pokemonData,
  minSmall,
  minMedium,
  minLarge,
  totalHouses,
  error,
}: UseSolverPipelineOptions) {
  const houseStore = useHouseStore()
  const pinStore = usePinStore()

  const result = ref<SolverResult | null>(null)
  const solving = ref(false)

  async function runSolve() {
    error.value = ''
    try {
      const res = await solveInWorker({
        pokemonNames: selectedPokemon.value,
        houses: houseStore.orderedHouses,
        pokemonData: pokemonData.value,
        adjacencyData: adjacencyData.value ?? undefined,
        pinnedAssignments: pinStore.getPinnedAssignments(),
      })
      // Late guard: the toggle may have flipped OFF while this worker run was in
      // flight — drop the result so the stale display stays consistent instead
      // of re-sorting once, transiently.
      if (!autoSort.value) {
        solving.value = false
        return
      }
      result.value = res
      solving.value = false
    } catch (e) {
      // Same late guard on the failure path: a late-failing solve must not
      // surface an error banner for a run the user already discarded by pausing.
      if (!autoSort.value) {
        solving.value = false
        return
      }
      // Superseded means a newer solve is already in flight; keep the spinner
      // on and let that newer run settle solving.value.
      if (e instanceof SupersededError) return
      error.value = e instanceof Error ? e.message : 'Solver failed'
      solving.value = false
    }
  }

  // 0ms in tests so flushPromises() settles the pending body; 150ms in dev/prod
  // collapses rapid interaction bursts into a single worker run.
  const SOLVE_DEBOUNCE_MS = import.meta.env.MODE === 'test' ? 0 : 150
  const debouncedSolve = debounce(runSolve, SOLVE_DEBOUNCE_MS)

  watch(
    [
      selectedPokemon,
      small,
      medium,
      large,
      hydratedPokemonReady,
      adjacencyData,
      autoSort,
      () => pinStore.pinnedPokemon,
      () => pinStore.pinnedHouses,
    ],
    () => {
      if (
        !adjacencyData.value ||
        !hydratedPokemonReady.value ||
        (totalHouses.value === 0 && selectedPokemon.value.length === 0)
      ) {
        debouncedSolve.cancel()
        // The null exists to prevent stale-render races against pruned
        // pokemonData while auto-sort is ON. While OFF, keep the stale
        // arrangement: the displayedHouses graft filters occupants to selected +
        // hydrated names and the warning only shows names, so rendering stays
        // safe — and the toggle gate below means no fresh solve is coming to
        // replace a wiped result.
        if (autoSort.value) result.value = null
        solving.value = false
        return
      }

      // Clamp house counts to minimums
      if (small.value < minSmall.value) small.value = minSmall.value
      if (medium.value < minMedium.value) medium.value = minMedium.value
      if (large.value < minLarge.value) large.value = minLarge.value

      // Reconcile house registry (structural bookkeeping — runs while OFF too
      // so the registry-authoritative display stays live).
      houseStore.reconcileHouses(
        { small: small.value, medium: medium.value, large: large.value },
        pinStore.effectivelyPinnedHouseIds,
      )

      // Auto-sort gate: while OFF, never dispatch the worker. House cards keep
      // showing the last solved arrangement (or registry-derived empty houses).
      if (!autoSort.value) {
        debouncedSolve.cancel()
        solving.value = false
        return
      }

      // Flip the spinner on immediately so the UI feels responsive while the
      // debounce window collapses bursts of rapid interactions.
      solving.value = true
      debouncedSolve()
    },
    { deep: true },
  )

  return { result, solving }
}
