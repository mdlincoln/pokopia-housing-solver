// Catalog hydration for HomeView. Owns the pokemon names / per-selection data /
// spawn-habitat thumbnails / adjacency refs and the lazy hydration + pruning
// functions. `hydratePokemonSelection` and `hydratedPokemonReady` are used by
// HomeView's restoreState glue and the solver pipeline, respectively.

import { loadPokemonData, loadSpawnHabitatsByName, type SpawnHabitat } from '@/queries'
import { type AdjacencyData, type PokemonData } from '@/solver'
import { usePinStore } from '@/stores/pins'
import { computed, nextTick, ref, type Ref } from 'vue'

export function useCatalog(selectedPokemon: Ref<string[]>) {
  const pinStore = usePinStore()

  const pokemonNames = ref<string[]>([])
  const pokemonData = ref<PokemonData>({})
  // Spawn-habitat thumbnails per pokemon name — hydrated alongside pokemonData
  // but kept separate so the solver PokemonData shape stays unchanged. Pruning
  // mirrors prunePokemonData (incl. pinned-pokemon survival).
  const spawnHabitatsByName = ref<Record<string, SpawnHabitat[]>>({})
  const adjacencyData = ref<AdjacencyData | null>(null)
  const hydratingPokemonData = ref(false)
  const pendingPokemonLoads = new Set<string>()

  const hydratedPokemonReady = computed(() => {
    const allSelected = selectedPokemon.value.every((name) => !!pokemonData.value[name])
    if (!allSelected) return false

    // During active hydration or pending loads, also verify that pokemon
    // referenced by pinned assignments exist in pokemonData. This prevents
    // the solver from running with stale data during a deselection race
    // condition (old data hasn't been pruned yet but async prune is pending).
    if (hydratingPokemonData.value || pendingPokemonLoads.size > 0) {
      for (const name of pinStore.allPinnedPokemonNames) {
        if (!pokemonData.value[name]) return false
      }
    }

    return true
  })

  function prunePokemonData(names: string[]) {
    const nextPokemonData: PokemonData = {}
    for (const name of names) {
      const entry = pokemonData.value[name]
      if (entry) {
        nextPokemonData[name] = entry
      }
    }
    // Preserve pinned pokemon data — they may remain in house assignments via
    // pinStore.getPinnedAssignments() even when not in selectedPokemon.
    for (const name of pinStore.allPinnedPokemonNames) {
      const entry = pokemonData.value[name]
      if (entry && !nextPokemonData[name]) {
        nextPokemonData[name] = entry
      }
    }
    const currentKeys = Object.keys(pokemonData.value)
    const nextKeys = Object.keys(nextPokemonData)
    if (
      currentKeys.length === nextKeys.length &&
      currentKeys.every((name) => Object.prototype.hasOwnProperty.call(nextPokemonData, name))
    ) {
      return
    }
    pokemonData.value = nextPokemonData
  }

  // Mirrors prunePokemonData for the spawn-habitat thumbnail map, including the
  // pinned-pokemon survival rule: a pinned pokemon deselected from the search
  // keeps its thumbnails while it remains rendered in its house.
  function pruneSpawnHabitats(names: string[]) {
    const keep = new Set([...names, ...pinStore.allPinnedPokemonNames])
    const nextSpawnHabitats: Record<string, SpawnHabitat[]> = {}
    for (const [name, habitats] of Object.entries(spawnHabitatsByName.value)) {
      if (keep.has(name)) nextSpawnHabitats[name] = habitats
    }
    const currentKeys = Object.keys(spawnHabitatsByName.value)
    const nextKeys = Object.keys(nextSpawnHabitats)
    if (
      currentKeys.length === nextKeys.length &&
      currentKeys.every((name) => Object.prototype.hasOwnProperty.call(nextSpawnHabitats, name))
    ) {
      return
    }
    spawnHabitatsByName.value = nextSpawnHabitats
  }

  async function hydratePokemonSelection(names: string[]) {
    prunePokemonData(names)
    pruneSpawnHabitats(names)

    // Flush Vue's async DOM update batch so watchers that depend on the new
    // pokemonData (e.g. the solve watch that sets result.value = null when
    // hydratedPokemonReady goes false) complete before we proceed with async
    // data loading. Without this, a brief re-render can occur where old
    // HouseRecord components reference names no longer in pruned pokemonData.
    await nextTick()

    const missingNames = names.filter(
      (name) => !pokemonData.value[name] && !pendingPokemonLoads.has(name),
    )
    if (missingNames.length === 0) {
      hydratingPokemonData.value = pendingPokemonLoads.size > 0
      return
    }

    hydratingPokemonData.value = true
    for (const name of missingNames) {
      pendingPokemonLoads.add(name)
    }

    try {
      const [loadedPokemon, loadedSpawnHabitats] = await Promise.all([
        loadPokemonData(missingNames),
        loadSpawnHabitatsByName(missingNames),
      ])
      const selected = new Set(selectedPokemon.value)
      const nextPokemonData: PokemonData = { ...pokemonData.value }
      for (const [name, entry] of Object.entries(loadedPokemon)) {
        if (selected.has(name)) {
          nextPokemonData[name] = entry
        }
      }
      // Deleted keys must exclude ALL pinned pokemon (not just still-selected
      // ones), mirroring prunePokemonData's pinned-pokemon survival so the two
      // pruning paths can never disagree mid-race: a pinned pokemon deselected
      // from the search (only reachable via restore/sample flows) keeps both
      // its pokemonData entry and its thumbnails.
      const pinned = pinStore.allPinnedPokemonNames
      for (const name of Object.keys(nextPokemonData)) {
        if (!selected.has(name) && !pinned.has(name)) {
          delete nextPokemonData[name]
        }
      }
      pokemonData.value = nextPokemonData

      // Merge only still-selected spawn habitats (pinned-survival pruning above
      // handles names deselected before this load resolves).
      const nextSpawnHabitats: Record<string, SpawnHabitat[]> = { ...spawnHabitatsByName.value }
      for (const [name, habitats] of Object.entries(loadedSpawnHabitats)) {
        if (selected.has(name)) {
          nextSpawnHabitats[name] = habitats
        }
      }
      spawnHabitatsByName.value = nextSpawnHabitats
    } finally {
      for (const name of missingNames) {
        pendingPokemonLoads.delete(name)
      }
      hydratingPokemonData.value = pendingPokemonLoads.size > 0
    }
  }

  return {
    pokemonNames,
    pokemonData,
    spawnHabitatsByName,
    adjacencyData,
    hydratingPokemonData,
    hydratedPokemonReady,
    hydratePokemonSelection,
  }
}
