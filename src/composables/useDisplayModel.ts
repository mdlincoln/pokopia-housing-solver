import { type PokemonData, type SolverResult } from '@/solver'
import { useHouseStore } from '@/stores/houses'
import { usePinStore } from '@/stores/pins'
import { usePlacementStore } from '@/stores/placements'
import { computed, type Ref } from 'vue'

interface UseDisplayModelOptions {
  result: Ref<SolverResult | null>
  selectedPokemon: Ref<string[]>
  pokemonData: Ref<PokemonData>
  autoSort: Ref<boolean>
}

export function useDisplayModel({
  result,
  selectedPokemon,
  pokemonData,
  autoSort,
}: UseDisplayModelOptions) {
  const houseStore = useHouseStore()
  const pinStore = usePinStore()
  const placementStore = usePlacementStore()

  // All island pokemon as a Set, built once per selection change so every
  // HouseRecord can pass it straight to topHouseMates / PokemonSelect as the
  // exclusion set without rebuilding per card.
  const islandPokemonSet = computed(() => new Set(selectedPokemon.value))

  // --- Display model (mode-gated) ----------------------------------------------
  //   ON  — exactly the solver-result view: the previous result stays visible
  //         across solves (fading via results-pending) and any registry drift is
  //         reconciled by the solve that lands.
  //   OFF — registry-authoritative: house adds/removes apply live from the
  //         registry. Occupants come from explicit pinned placements (a pokemon
  //         added to a house while OFF is pinned to it and shows there
  //         immediately) overlaid on the last solved arrangement, then filtered
  //         to still-selected-or-pinned and hydrated names so deselection and
  //         unhydrated newcomers never reference pruned pokemonData entries.
  const displayedHouses = computed(() => {
    if (autoSort.value) {
      return result.value?.houses ?? []
    }
    const pinnedAssignments = pinStore.getPinnedAssignments()
    const base = houseStore.orderedHouses.map((entry) => {
      const hydrated = (name: string) => !!pokemonData.value[name]
      const shown = (name: string) =>
        (islandPokemonSet.value.has(name) || pinStore.allPinnedPokemonNames.has(name)) &&
        hydrated(name)
      // Pinned names first (they are the authoritative explicit placements, and
      // pinned occupants survive deselection — mirroring prunePokemonData's
      // pinned-pokemon survival rule), then the last solve's occupants.
      const pinnedNames = (pinnedAssignments.get(entry.id) ?? []).filter(hydrated)
      const leftover = (
        result.value?.houses.find((h) => h.houseId === entry.id)?.pokemon ?? []
      ).filter(shown)
      const seen = new Set<string>()
      const pokemon: string[] = []
      for (const name of [...pinnedNames, ...leftover]) {
        if (seen.has(name)) continue
        seen.add(name)
        pokemon.push(name)
      }
      return { houseId: entry.id, size: entry.size, capacity: entry.capacity, pokemon }
    })

    // Drag-override layer: temporary placements (session-only, never persisted)
    // relocate a pokemon on top of the pinned + leftover graft. Entries for a
    // deselected name are filtered out here (their lifetime is bounded by the
    // clear points), and drops never touch pinStore.
    const overrides = new Map<string, string | null>()
    for (const [name, target] of placementStore.placements) {
      if (islandPokemonSet.value.has(name) || pinStore.allPinnedPokemonNames.has(name)) {
        overrides.set(name, target)
      }
    }
    const byHouse = new Map(houseStore.orderedHouses.map((entry) => [entry.id, [] as string[]]))
    for (const entry of base) byHouse.set(entry.houseId, [...entry.pokemon])
    for (const [name, target] of overrides) {
      for (const list of byHouse.values()) {
        const i = list.indexOf(name)
        if (i !== -1) list.splice(i, 1)
      }
      if (target !== null && byHouse.has(target)) byHouse.get(target)!.push(name)
    }
    return houseStore.orderedHouses.map((entry) => ({
      houseId: entry.id,
      size: entry.size,
      capacity: entry.capacity,
      pokemon: byHouse.get(entry.id) ?? [],
    }))
  })

  const sortedHouses = computed(() => {
    return [...displayedHouses.value].sort((a, b) => {
      const aPinned = pinStore.isHousePinned(a.houseId) ? 1 : 0
      const bPinned = pinStore.isHousePinned(b.houseId) ? 1 : 0
      return aPinned - bPinned
    })
  })

  const displayedHouseOccupants = computed(
    () => new Set(displayedHouses.value.flatMap((house) => house.pokemon)),
  )

  // Mode-gated unhoused list. ON keeps the solver-derived order/timing (and the
  // pending-window fade); OFF is selection-derived so every not-yet-solved
  // pokemon lands in the warning.
  const displayedUnhoused = computed(() =>
    autoSort.value
      ? (result.value?.unhoused ?? [])
      : selectedPokemon.value.filter((name) => !displayedHouseOccupants.value.has(name)),
  )

  // Guard: only render results when all pokemon referenced by the rendered
  // houses AND the unhoused warning actually exist in pokemonData. The unhoused
  // card grid (unlike the old raw-name <li> list) needs image/favorites per
  // member, so an incomplete hydration (deselection race, URL restore, or the
  // result.value = null path) must gate the whole section until every name is
  // hydrated — never flash an image-less/favorites-less card.
  const resultsSafeToRender = computed(() => {
    for (const house of displayedHouses.value) {
      for (const name of house.pokemon) {
        if (!pokemonData.value[name]) return false
      }
    }
    for (const name of displayedUnhoused.value) {
      if (!pokemonData.value[name]) return false
    }
    return true
  })

  // Section visibility. ON keeps today's behavior exactly: hidden until a result
  // lands (the fresh empty page renders no results section). OFF always renders
  // the section as long as auto-sort is off — so the "Unhoused pokemon" alert is a
  // persistent drop target (and the unassigned area always reachable) regardless
  // of how many houses or pokemon are configured.
  const showResults = computed(() => {
    const wantsResults = autoSort.value ? !!result.value : true
    return wantsResults && resultsSafeToRender.value
  })

  return {
    displayedHouses,
    sortedHouses,
    resultsSafeToRender,
    showResults,
    displayedHouseOccupants,
    displayedUnhoused,
    islandPokemonSet,
  }
}
