<script setup lang="ts">
import AutoSortCard from '@/components/AutoSortCard.vue'
import HouseRecord from '@/components/HouseRecord.vue'
import HousesConfigCard from '@/components/HousesConfigCard.vue'
import PokemonCard from '@/components/PokemonCard.vue'
import PokemonConfigCard from '@/components/PokemonConfigCard.vue'
import SavedIslandsCard from '@/components/SavedIslandsCard.vue'
import {
  loadAdjacencyMap,
  loadItemGraph,
  loadPokemonData,
  loadPokemonNames,
  loadSpawnHabitatsByName,
  type SpawnHabitat,
} from '@/queries'
import { type AdjacencyData, type PokemonData, type SolverResult } from '@/solver'
import { solveInWorker, SupersededError } from '@/solverClient'
import { DRAG_THRESHOLD_PX, resolveDropTarget, type DropTarget } from '@/composables/usePokemonDrag'
import { debounce } from '@/utils/debounce'
import { nextTick } from 'vue'
import { useCartStore } from '@/stores/cart'
import { useHouseStore } from '@/stores/houses'
import { usePinStore } from '@/stores/pins'
import { usePlacementStore } from '@/stores/placements'
import { useProgressStore } from '@/stores/progress'
import {
  BAlert,
  BButton,
  BCol,
  BFormGroup,
  BFormInput,
  BModal,
  BRow,
  BSpinner,
} from 'bootstrap-vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const cartStore = useCartStore()
const houseStore = useHouseStore()
const pinStore = usePinStore()
const placementStore = usePlacementStore()
const progressStore = useProgressStore()

const pokemonNames = ref<string[]>([])
const pokemonData = ref<PokemonData>({})
// Spawn-habitat thumbnails per pokemon name — hydrated alongside pokemonData
// but kept separate so the solver PokemonData shape stays unchanged. Pruning
// mirrors prunePokemonData (incl. pinned-pokemon survival).
const spawnHabitatsByName = ref<Record<string, SpawnHabitat[]>>({})
const adjacencyData = ref<AdjacencyData | null>(null)
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
const selectedPokemon = ref<string[]>([])

// "Automatically sort Pokemon" toggle (AutoSortCard). While ON the reactive
// solve watch behaves exactly as before; while OFF the watch gates the worker
// dispatch (structural house clamp/reconcile still run) and the display model
// below switches to a registry-authoritative stale view. Persisted in the URL
// hash and saved islands via SharedState.autoSort (missing key restores true).
const autoSort = ref(true)

// Dragged placements are session-only: any mode/restore boundary clears the
// override map so drags never leak across flips, restores, or resets.
watch(
  () => autoSort.value,
  () => placementStore.clear(),
)

// All island pokemon as a Set, built once per selection change so every
// HouseRecord can pass it straight to topHouseMates / PokemonSelect as the
// exclusion set without rebuilding per card.
const islandPokemonSet = computed(() => new Set(selectedPokemon.value))

// Empty-slot flow (HouseRecord "+" cards / empty-house input): add the
// pokemon to the island AND pin it to the requesting house BEFORE the next
// debounced solve, so the pin-complement fill keeps the newcomer in place.
function addPokemonToHouse({ houseId, name }: { houseId: string; name: string }) {
  // The selection UIs exclude island residents, but guard anyway: a duplicate
  // would double-count the pokemon in the island set.
  if (selectedPokemon.value.includes(name)) return
  pinStore.pinPokemon(houseId, name)
  selectedPokemon.value = [...selectedPokemon.value, name]
}

const small = ref(0)
const medium = ref(0)
const large = ref(0)

const totalHouses = computed(() => small.value + medium.value + large.value)

const minSmall = computed(() => {
  const locked = houseStore.lockedCountBySize(pinStore.effectivelyPinnedHouseIds)
  return locked.small
})
const minMedium = computed(() => {
  const locked = houseStore.lockedCountBySize(pinStore.effectivelyPinnedHouseIds)
  return locked.medium
})
const minLarge = computed(() => {
  const locked = houseStore.lockedCountBySize(pinStore.effectivelyPinnedHouseIds)
  return locked.large
})

const hydratingPokemonData = ref(false)
const solving = ref(false)
const loading = computed(() => hydratingPokemonData.value || solving.value)

// Catalog-ready gate: false until the initial names/adjacency load (and any
// URL-hash restore) inside onMounted has finished. `restoringQuery` covers
// restores of saved queries from localStorage via the saved-queries select.
const catalogReady = ref(false)
const restoringQuery = ref(false)
const showCatalogLoading = computed(() => !catalogReady.value || restoringQuery.value)
const error = ref('')
const result = ref<SolverResult | null>(null)

// Display model (mode-gated):
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

interface SavedQuery {
  title: string
  timestamp: number
  small: number
  medium: number
  large: number
  pokemon: string[]
  autoSort?: boolean
  cart?: Array<{ houseId?: string; houseIndex?: number; name: string; quantity?: number }>
  checkedHouses?: number[]
  checkedPokemon?: string[]
  checkedCartItems?: string[]
  placedItems?: string[]
  pinnedHouses?: string[]
  pinnedPokemon?: string[]
  houseRegistry?: Array<{ id: string; size: string }>
  houseCounters?: Record<string, number>
  version?: number
}

const STORAGE_KEY = 'pokehousing_saved_queries'

type SharedState = Omit<SavedQuery, 'title' | 'timestamp'>

let restoringFromUrl = false
const pendingPokemonLoads = new Set<string>()

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

function encodeState(): string {
  const state: SharedState = {
    version: 2,
    small: small.value,
    medium: medium.value,
    large: large.value,
    pokemon: [...selectedPokemon.value],
    autoSort: autoSort.value,
    cart: cartStore.serializedCart,
    ...progressStore.toSerializable(),
    ...pinStore.toSerializable(),
    ...houseStore.toSerializable(),
  }
  return btoa(JSON.stringify(state))
}

function decodeStateFromUrl(): SharedState | null {
  const hash = window.location.hash.slice(1)
  if (!hash) return null
  try {
    return JSON.parse(atob(hash))
  } catch {
    return null
  }
}

function loadSavedQueries(): SavedQuery[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

const savedQueries = ref<SavedQuery[]>(loadSavedQueries())
const selectedTimestamp = ref<number | null>(null)
const queryTitle = ref('')
const showSaveModal = ref(false)
const showManageModal = ref(false)
const saveSuccess = ref(false)

// Single-slot undo for saved-island deletions. A second deletion while the
// undo alert is visible replaces the stash — acceptable for low-stakes
// localStorage data, and deliberately keeps this from growing into a general
// undo queue.
const deletedUndo = ref<{ entry: SavedQuery; index: number } | null>(null)
const UNDO_WINDOW_MS = 8000
let undoTimer: ReturnType<typeof setTimeout> | undefined

const deletedUndoTitle = computed(() => {
  const stash = deletedUndo.value
  if (!stash) return ''
  return stash.entry.title || new Date(stash.entry.timestamp).toLocaleString()
})

function persistSavedQueries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedQueries.value))
}

function deleteSaved(timestamp: number) {
  const index = savedQueries.value.findIndex((q) => q.timestamp === timestamp)
  if (index === -1) return
  const entry = savedQueries.value[index]!
  savedQueries.value.splice(index, 1)
  persistSavedQueries()
  // Restoring from the select is one-shot (selectedTimestamp watch); a deleted
  // entry must not linger as the selected value or a later re-select of the
  // same timestamp could trigger a stale restore.
  if (selectedTimestamp.value === timestamp) {
    selectedTimestamp.value = null
  }
  clearTimeout(undoTimer)
  deletedUndo.value = { entry, index }
  undoTimer = setTimeout(() => {
    deletedUndo.value = null
  }, UNDO_WINDOW_MS)
}

function undoDelete() {
  clearTimeout(undoTimer)
  const stash = deletedUndo.value
  if (!stash) return
  deletedUndo.value = null
  savedQueries.value.splice(Math.min(stash.index, savedQueries.value.length), 0, stash.entry)
  persistSavedQueries()
}

onUnmounted(() => {
  clearTimeout(undoTimer)
})

function openSaveModal() {
  queryTitle.value = ''
  showSaveModal.value = true
}

function confirmSave() {
  const entry: SavedQuery = {
    title: queryTitle.value.trim(),
    timestamp: Date.now(),
    version: 2,
    small: small.value,
    medium: medium.value,
    large: large.value,
    pokemon: [...selectedPokemon.value],
    autoSort: autoSort.value,
    cart: cartStore.serializedCart,
    ...progressStore.toSerializable(),
    ...pinStore.toSerializable(),
    ...houseStore.toSerializable(),
  }
  savedQueries.value = [entry, ...savedQueries.value]
  persistSavedQueries()
  saveSuccess.value = true
  setTimeout(() => {
    saveSuccess.value = false
  }, 3000)
}

// Enter in the modal title input saves and closes exactly once. The modal's
// own @ok handler still fires for button clicks; closing explicitly here
// prevents the modal from also treating Enter as a default action.
function onSaveEnter() {
  confirmSave()
  showSaveModal.value = false
}

async function restoreState(query: SharedState) {
  // FIRST: an off-state restore must be in place before the pokemon hydration
  // below completes — the solve watch is not suppressed during restore (unlike
  // the hash watch) and would otherwise dispatch an initial solve.
  autoSort.value = query.autoSort ?? true
  // Placement overrides are never serialized: any restore drops them.
  placementStore.clear()
  small.value = query.small
  medium.value = query.medium
  large.value = query.large
  selectedPokemon.value = [...query.pokemon]
  await hydratePokemonSelection(query.pokemon)

  // Restore house registry if available (version 2+)
  if (query.houseRegistry) {
    houseStore.restoreRegistry(query)
  } else {
    // Legacy: create fresh house IDs
    houseStore.clear()
    houseStore.reconcileHouses(
      { small: query.small, medium: query.medium, large: query.large },
      new Set(),
    )
  }

  // Restore pins if available (version 2+)
  if (query.pinnedHouses || query.pinnedPokemon) {
    pinStore.restorePins(query)
  } else {
    pinStore.clear()
  }

  await cartStore.restoreItems(query.cart ?? [])
  progressStore.restoreProgress(query)
}

watch(selectedTimestamp, async (ts) => {
  if (ts === null) return
  const query = savedQueries.value.find((q) => q.timestamp === ts)
  if (!query) return
  restoringQuery.value = true
  try {
    await restoreState(query)
  } finally {
    restoringQuery.value = false
  }
})

onMounted(async () => {
  try {
    // Fire-and-forget: preload the item graph so the first cart interaction is
    // pure in-memory (the cached promise means every item helper shares this load).
    void loadItemGraph()
    const [names, adjacency] = await Promise.all([loadPokemonNames(), loadAdjacencyMap()])
    pokemonNames.value = names
    adjacencyData.value = adjacency

    const shared = decodeStateFromUrl()
    if (shared) {
      restoringFromUrl = true
      await restoreState(shared)
      restoringFromUrl = false
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    catalogReady.value = true
  }
})

watch(
  selectedPokemon,
  async (names) => {
    await hydratePokemonSelection(names)
  },
  { deep: true },
)

watch(
  [
    small,
    medium,
    large,
    selectedPokemon,
    autoSort,
    () => cartStore.serializedCart,
    () => progressStore.checkedCartItems,
    () => progressStore.placedItems,
    () => pinStore.pinnedHouses,
    () => pinStore.pinnedPokemon,
  ],
  () => {
    if (restoringFromUrl) return
    const encoded = encodeState()
    if (window.location.hash === '#' + encoded) return
    history.replaceState(null, '', '#' + encoded)
  },
  { deep: true },
)

function loadSample() {
  pinStore.clear()
  placementStore.clear()
  progressStore.restoreProgress({})
  houseStore.clear()
  small.value = 1
  medium.value = 3
  large.value = 2
  houseStore.reconcileHouses({ small: 1, medium: 3, large: 2 }, new Set())
  const shuffled = [...pokemonNames.value].sort(() => Math.random() - 0.5)
  selectedPokemon.value = shuffled.slice(0, 13)
}

function clearHouses() {
  small.value = 0
  medium.value = 0
  large.value = 0
  placementStore.clear()
}

function clearPokemon() {
  selectedPokemon.value = []
  pokemonData.value = {}
  spawnHabitatsByName.value = {}
  placementStore.clear()
}

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

// --- Drag & drop (pointer events) ------------------------------------------
// Session-only temporary placements. Drags are inert while auto-sort is ON,
// for pinned cards, and for presses landing on interactive controls (lock,
// fave-badge, habitat-thumb, search input) so those keep their click behavior.
// The 6px threshold separates a click from a drag; pointer capture is deferred
// until the threshold so a pure click never captures and the synthesized click
// still lands on the originally-hit control.
const dragOverTarget = ref<DropTarget | null>(null)
const draggingName = ref<string | null>(null)
const dragPos = ref<{ x: number; y: number } | null>(null)

interface ArmedDrag {
  pointerId: number
  el: HTMLElement
  name: string
  fromHouseId: string | null
  started: boolean
  startX: number
  startY: number
}

let armed: ArmedDrag | null = null

// While an active drag is underway the pointer sweeps across cards and other
// text, which the browser would otherwise turn into a giant clipboard selection.
// Lock user-select for the duration of the drag only, and clear any partial
// selection that started before the threshold — deliberate text selection
// outside a drag is untouched.
function setDragSelectionLock(active: boolean) {
  const style = document.body.style
  style.userSelect = active ? 'none' : ''
  style.webkitUserSelect = active ? 'none' : ''
  if (active) window.getSelection()?.removeAllRanges()
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest('button, input, a, [role="checkbox"], [role="combobox"]')
  )
}

function onPointerDown(e: PointerEvent) {
  if (armed) return
  const target = e.target
  if (!(target instanceof Element)) return
  const el = target.closest('[data-drag-source]') as HTMLElement | null
  if (!el) return
  if (el.dataset.draggable !== 'true') return
  if (autoSort.value) return
  if (isInteractiveTarget(target)) return
  // The move gesture (and its affordance) lives solely on the header's move-arrow
  // icon — pressing anywhere else on the card (name, image, favorites) must not
  // arm a drag.
  if (!target.closest('.pokemon-drag-handle')) return

  armed = {
    pointerId: e.pointerId,
    el,
    name: el.dataset.dragName ?? '',
    fromHouseId: el.dataset.fromHouse || null,
    started: false,
    startX: e.clientX,
    startY: e.clientY,
  }
}

function onPointerMove(e: PointerEvent) {
  if (!armed || e.pointerId !== armed.pointerId) return

  if (!armed.started) {
    if (Math.hypot(e.clientX - armed.startX, e.clientY - armed.startY) <= DRAG_THRESHOLD_PX) {
      return
    }
    armed.started = true
    try {
      armed.el.setPointerCapture(armed.pointerId)
    } catch {
      // jsdom / non-supporting environments proceed without capture; the real
      // pointer path is exercised end-to-end.
    }
    setDragSelectionLock(true)
    draggingName.value = armed.name
    dragPos.value = { x: e.clientX, y: e.clientY }
    armed.el.classList.add('pokemon-card--dragging')
  }

  dragPos.value = { x: e.clientX, y: e.clientY }
  const t = resolveDropTarget(e.clientX, e.clientY)
  if (!sameTarget(t, dragOverTarget.value)) dragOverTarget.value = t
}

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a.type !== b.type) return false
  return (
    a.type === 'unhoused' || (a.type === 'house' && b.type === 'house' && a.houseId === b.houseId)
  )
}

// Drops never touch pinStore — only the ephemeral placement override.
function applyDrop(name: string, target: DropTarget | null) {
  if (target === null) return // released over empty space: cancel the move
  if (target.type === 'unhoused') {
    placementStore.set(name, null)
    return
  }
  // House target: block a drop into a full house. displayedHouses already
  // carries capacity + this render's post-override occupants.
  const house = displayedHouses.value.find((h) => h.houseId === target.houseId)
  if (!house) return
  const occupants = house.pokemon.filter((n) => n !== name)
  if (occupants.length >= house.capacity) return
  placementStore.set(name, target.houseId)
}

function resetDrag() {
  if (armed) {
    armed.el.classList.remove('pokemon-card--dragging')
    if (armed.started) {
      try {
        if (armed.el.hasPointerCapture?.(armed.pointerId)) {
          armed.el.releasePointerCapture(armed.pointerId)
        }
      } catch {
        // ignore release failures
      }
    }
  }
  armed = null
  draggingName.value = null
  dragPos.value = null
  dragOverTarget.value = null
  setDragSelectionLock(false)
}

function onPointerUp(e: PointerEvent) {
  if (!armed || e.pointerId !== armed.pointerId) return
  const name = armed.name
  const started = armed.started
  // Resolve while the dragged card is still pointer-events:none so the zone is
  // whatever sits beneath the pointer, not the ghost or the card itself.
  const target = started ? resolveDropTarget(e.clientX, e.clientY) : null
  resetDrag()
  if (started && name) applyDrop(name, target)
}

// A cancelled pointer (scroll/system gesture took over the pointer) must never
// relocate the card — just tear the drag down.
function onPointerCancel(e: PointerEvent) {
  if (!armed || e.pointerId !== armed.pointerId) return
  resetDrag()
}

defineExpose({
  small,
  medium,
  large,
  selectedPokemon,
  autoSort,
  solving,
  spawnHabitatsByName,
  queryTitle,
  confirmSave,
  selectedTimestamp,
  savedQueries,
  showSaveModal,
  showManageModal,
  deleteSaved,
  undoDelete,
  onSaveEnter,
  addPokemonToHouse,
})
</script>

<template>
  <div
    v-if="showCatalogLoading"
    data-testid="catalog-loading"
    class="d-flex flex-column align-items-center justify-content-center gap-3 catalog-loading"
    role="status"
    aria-live="polite"
  >
    <BSpinner />
    <p>{{ restoringQuery ? 'Restoring saved island…' : 'Loading catalog…' }}</p>
  </div>

  <div v-if="!showCatalogLoading" class="home-theme content-stack">
    <BAlert
      variant="info"
      data-testid="sample-island-alert"
      class="d-flex flex-wrap align-items-center justify-content-center gap-2 mb-0 sample-island-alert"
      :model-value="true"
    >
      <span class="me-2">Not sure where to start?</span>
      <BButton variant="outline-secondary" class="beach-button" @click="loadSample">
        Show a sample island
      </BButton>
    </BAlert>
    <BRow class="g-2 g-md-3">
      <BCol cols="12" xl="2">
        <AutoSortCard v-model="autoSort" />
      </BCol>
      <BCol cols="12" xl="3">
        <HousesConfigCard
          :small="small"
          :medium="medium"
          :large="large"
          :min-small="minSmall"
          :min-medium="minMedium"
          :min-large="minLarge"
          @update:small="small = $event"
          @update:medium="medium = $event"
          @update:large="large = $event"
          @clear-all="clearHouses"
        />
      </BCol>
      <BCol cols="12" xl="3">
        <PokemonConfigCard
          :selected-pokemon="selectedPokemon"
          :pokemon-names="pokemonNames"
          :pinned-names="pinStore.allPinnedPokemonNames"
          @update:selected-pokemon="selectedPokemon = $event"
          @clear-all="clearPokemon"
        />
      </BCol>
      <BCol cols="12" xl="4">
        <SavedIslandsCard
          :saved-queries="savedQueries"
          :selected-timestamp="selectedTimestamp"
          :save-success="saveSuccess"
          :deleted-undo-title="deletedUndoTitle"
          :can-save="pokemonNames.length > 0"
          @update:selected-timestamp="selectedTimestamp = $event"
          @save="openSaveModal"
          @manage="showManageModal = true"
          @undo="undoDelete"
        />
      </BCol>
    </BRow>

    <BModal
      v-model="showSaveModal"
      title="Save island"
      title-tag="h2"
      ok-title="Save"
      ok-variant="primary"
      cancel-variant="secondary"
      @ok="confirmSave"
    >
      <BFormGroup label="Title (optional)" label-for="query-title-input">
        <BFormInput
          id="query-title-input"
          v-model="queryTitle"
          placeholder="e.g. My island layout"
          @keydown.enter.prevent="onSaveEnter"
        />
      </BFormGroup>
    </BModal>

    <BModal
      v-model="showManageModal"
      title="Saved islands"
      title-tag="h2"
      data-testid="saved-queries-modal"
      hide-footer
    >
      <p v-if="!savedQueries.length" class="text-muted mb-0">No saved islands.</p>
      <ul v-else class="list-group">
        <li
          v-for="q in savedQueries"
          :key="q.timestamp"
          class="list-group-item d-flex justify-content-between align-items-center gap-2"
        >
          <span>
            {{ q.title || new Date(q.timestamp).toLocaleString() }}
            <span v-if="q.title" class="text-muted"
              >({{ new Date(q.timestamp).toLocaleString() }})</span
            >
          </span>
          <BButton
            variant="outline-danger"
            class="beach-button beach-button--sm"
            data-testid="saved-query-delete"
            :aria-label="`Delete saved island ${q.title || new Date(q.timestamp).toLocaleString()}`"
            @click="deleteSaved(q.timestamp)"
          >
            Delete
          </BButton>
        </li>
      </ul>
    </BModal>

    <BSpinner v-if="loading" class="my-3" />
  </div>

  <BAlert
    v-if="error"
    variant="danger"
    :model-value="true"
    data-testid="error"
    class="mt-2 status-alert"
  >
    {{ error }}
  </BAlert>

  <section
    v-if="showResults && !showCatalogLoading"
    data-testid="results"
    class="results-section"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
  >
    <h2 class="section-heading">Results</h2>

    <div
      v-if="draggingName"
      class="pokemon-drag-ghost"
      :style="{
        left: (dragPos?.x ?? 0) + 'px',
        top: (dragPos?.y ?? 0) + 'px',
      }"
    >
      {{ draggingName }}
    </div>

    <BAlert
      v-if="!autoSort || displayedUnhoused.length"
      variant="warning"
      :model-value="true"
      data-testid="unhoused"
      class="mt-3"
    >
      <template v-if="autoSort">
        <h3 class="alert-heading">Not enough housing</h3>
        <p class="mb-1">Add houses above to place these Pokémon:</p>
      </template>
      <template v-else>
        <h3 class="alert-heading">Unhoused pokemon</h3>
        <p class="mb-1">Drag a Pokémon from a house into this area to unhouse it.</p>
      </template>
      <div
        class="unhoused-grid drop-zone"
        data-testid="unhoused-pokemon-grid"
        data-drop-zone="unhoused"
        :class="{ 'drop-zone--over': dragOverTarget?.type === 'unhoused' }"
      >
        <PokemonCard
          v-for="name in displayedUnhoused"
          :key="name"
          :name="name"
          :image="pokemonData[name]?.image ?? ''"
          :favorites="pokemonData[name]?.favorites ?? []"
          :habitat="pokemonData[name]?.habitat"
          context="unhoused"
          :house-id="null"
          :drag-enabled="!autoSort"
        />
        <!-- While auto-sort is off the alert always renders so it is a persistent
             drop target; when empty, a dashed placeholder keeps that space
             visible (and droppable) instead of collapsing to zero height. -->
        <p
          v-if="!autoSort && displayedUnhoused.length === 0"
          class="unhoused-empty-hint"
          data-testid="unhoused-empty-hint"
        >
          Drop a Pokémon here to unhouse it
        </p>
      </div>
    </BAlert>

    <TransitionGroup
      tag="div"
      class="list-group list-group-flush w-100 results-list"
      :class="{ 'results-pending': solving }"
      move-class="house-move"
    >
      <HouseRecord
        v-for="house in sortedHouses"
        :key="house.houseId"
        :house="house"
        :pokemon-data="pokemonData!"
        :spawn-habitats-by-name="spawnHabitatsByName"
        :all-pokemon-names="pokemonNames"
        :island-pokemon="islandPokemonSet"
        :adjacency-data="adjacencyData"
        :drag-enabled="!autoSort"
        :drop-over="
          dragOverTarget != null &&
          dragOverTarget.type === 'house' &&
          dragOverTarget.houseId === house.houseId
        "
        :auto-sort="autoSort"
        @add-pokemon="addPokemonToHouse"
        @update:auto-sort="autoSort = $event"
      />
    </TransitionGroup>
  </section>
</template>
