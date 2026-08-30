<script setup lang="ts">
import HouseRecord from '@/components/HouseRecord.vue'
import HousesConfigCard from '@/components/HousesConfigCard.vue'
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
import { debounce } from '@/utils/debounce'
import { nextTick } from 'vue'
import { useCartStore } from '@/stores/cart'
import { useHouseStore } from '@/stores/houses'
import { usePinStore } from '@/stores/pins'
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
// Guard: only render results when all pokemon referenced by the result
// actually exist in pokemonData. This prevents a race condition where Vue's
// async DOM update batch causes the old <section> to briefly re-render with
// stale house assignments against pruned pokemonData (e.g. during deselection,
// URL restore, or clearAll). The solver validates names at solve-time but the
// template accesses them at render-time — between those two moments,
// pokemonData can be pruned by hydration while the result is still displayed.
const resultsSafeToRender = computed(() => {
  if (!result.value) return false
  for (const house of result.value.houses) {
    for (const name of house.pokemon) {
      if (!pokemonData.value[name]) return false
    }
  }
  return true
})

const selectedPokemon = ref<string[]>([])

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
const sortedHouses = computed(() => {
  if (!result.value) return []
  return [...result.value.houses].sort((a, b) => {
    const aPinned = pinStore.isHousePinned(a.houseId) ? 1 : 0
    const bPinned = pinStore.isHousePinned(b.houseId) ? 1 : 0
    return aPinned - bPinned
  })
})

interface SavedQuery {
  title: string
  timestamp: number
  small: number
  medium: number
  large: number
  pokemon: string[]
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
}

function clearPokemon() {
  selectedPokemon.value = []
  pokemonData.value = {}
  spawnHabitatsByName.value = {}
}

async function runSolve() {
  error.value = ''
  try {
    result.value = await solveInWorker({
      pokemonNames: selectedPokemon.value,
      houses: houseStore.orderedHouses,
      pokemonData: pokemonData.value,
      adjacencyData: adjacencyData.value ?? undefined,
      pinnedAssignments: pinStore.getPinnedAssignments(),
    })
    solving.value = false
  } catch (e) {
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
      result.value = null
      solving.value = false
      return
    }

    // Clamp house counts to minimums
    if (small.value < minSmall.value) small.value = minSmall.value
    if (medium.value < minMedium.value) medium.value = minMedium.value
    if (large.value < minLarge.value) large.value = minLarge.value

    // Reconcile house registry
    houseStore.reconcileHouses(
      { small: small.value, medium: medium.value, large: large.value },
      pinStore.effectivelyPinnedHouseIds,
    )

    // Flip the spinner on immediately so the UI feels responsive while the
    // debounce window collapses bursts of rapid interactions.
    solving.value = true
    debouncedSolve()
  },
  { deep: true },
)

defineExpose({
  small,
  medium,
  large,
  selectedPokemon,
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
      <BCol cols="12" xl="4">
        <PokemonConfigCard
          :selected-pokemon="selectedPokemon"
          :pokemon-names="pokemonNames"
          :pinned-names="pinStore.allPinnedPokemonNames"
          @update:selected-pokemon="selectedPokemon = $event"
          @clear-all="clearPokemon"
        />
      </BCol>
      <BCol cols="12" xl="5">
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
    v-if="resultsSafeToRender && !showCatalogLoading"
    data-testid="results"
    class="results-section"
  >
    <h2 class="section-heading">Results</h2>

    <BAlert
      v-if="result!.unhoused.length"
      variant="warning"
      :model-value="true"
      data-testid="unhoused"
      class="mt-3"
    >
      <h3 class="alert-heading">Not enough housing</h3>
      <p class="mb-1">Add houses above to place these Pokémon:</p>
      <ul class="mb-0">
        <li v-for="name in result!.unhoused" :key="name">{{ name }}</li>
      </ul>
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
        @add-pokemon="addPokemonToHouse"
      />
    </TransitionGroup>
  </section>
</template>
