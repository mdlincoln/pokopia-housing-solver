<script setup lang="ts">
import HouseRecord from '@/components/HouseRecord.vue'
import PokemonSelect from '@/components/PokemonSelect.vue'
import { loadAdjacencyMap, loadPokemonData, loadPokemonNames } from '@/queries'
import { solve, type AdjacencyMap, type PokemonData, type SolverResult } from '@/solver'
import { useCartStore } from '@/stores/cart'
import { useHouseStore } from '@/stores/houses'
import { usePinStore } from '@/stores/pins'
import { useProgressStore } from '@/stores/progress'
import {
  BAlert,
  BButton,
  BCard,
  BCardBody,
  BCol,
  BFormGroup,
  BFormInput,
  BFormSelect,
  BFormSpinbutton,
  BListGroup,
  BModal,
  BRow,
  BSpinner,
} from 'bootstrap-vue-next'
import { computed, onMounted, ref, watch } from 'vue'

const cartStore = useCartStore()
const houseStore = useHouseStore()
const pinStore = usePinStore()
const progressStore = useProgressStore()

const pokemonNames = ref<string[]>([])
const pokemonData = ref<PokemonData>({})
const adjacencyData = ref<AdjacencyMap | null>(null)
const hydratedPokemonReady = computed(() =>
  selectedPokemon.value.every((name) => !!pokemonData.value[name]),
)
const selectedPokemon = ref<string[]>([])

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
const error = ref('')
const result = ref<SolverResult | null>(null)

interface SavedQuery {
  title: string
  timestamp: number
  small: number
  medium: number
  large: number
  pokemon: string[]
  cart?: Array<{ houseId?: string; houseIndex?: number; name: string; quantity: number }>
  checkedHouses?: number[]
  checkedPokemon?: string[]
  checkedCartItems?: string[]
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

async function hydratePokemonSelection(names: string[]) {
  prunePokemonData(names)

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
    const loadedPokemon = await loadPokemonData(missingNames)
    const selected = new Set(selectedPokemon.value)
    const nextPokemonData: PokemonData = { ...pokemonData.value }
    for (const [name, entry] of Object.entries(loadedPokemon)) {
      if (selected.has(name)) {
        nextPokemonData[name] = entry
      }
    }
    for (const name of Object.keys(nextPokemonData)) {
      if (!selected.has(name)) {
        delete nextPokemonData[name]
      }
    }
    pokemonData.value = nextPokemonData
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
    cart: cartStore.itemList.map(({ houseId, name, quantity }) => ({
      houseId,
      name,
      quantity,
    })),
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
const saveSuccess = ref(false)

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
    cart: cartStore.itemList.map(({ houseId, name, quantity }) => ({
      houseId,
      name,
      quantity,
    })),
    ...progressStore.toSerializable(),
    ...pinStore.toSerializable(),
    ...houseStore.toSerializable(),
  }
  savedQueries.value = [entry, ...savedQueries.value]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedQueries.value))
  saveSuccess.value = true
  setTimeout(() => {
    saveSuccess.value = false
  }, 3000)
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
  await restoreState(query)
})

onMounted(async () => {
  const [names, adjacency] = await Promise.all([loadPokemonNames(), loadAdjacencyMap()])
  pokemonNames.value = names
  adjacencyData.value = adjacency

  const shared = decodeStateFromUrl()
  if (shared) {
    restoringFromUrl = true
    await restoreState(shared)
    restoringFromUrl = false
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
    () => cartStore.itemList,
    () => progressStore.checkedCartItems,
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

function clearAll() {
  pinStore.clear()
  progressStore.restoreProgress({})
  houseStore.clear()
  small.value = 0
  medium.value = 0
  large.value = 0
  selectedPokemon.value = []
  pokemonData.value = {}
}

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
  async () => {
    if (!adjacencyData.value || totalHouses.value === 0 || !hydratedPokemonReady.value) {
      result.value = null
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

    solving.value = true
    error.value = ''
    try {
      result.value = await solve(
        selectedPokemon.value,
        houseStore.orderedHouses,
        pokemonData.value,
        adjacencyData.value,
        pinStore.getPinnedAssignments(),
      )
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Solver failed'
    } finally {
      solving.value = false
    }
  },
  { deep: true },
)

defineExpose({
  small,
  medium,
  large,
  selectedPokemon,
  queryTitle,
  confirmSave,
  selectedTimestamp,
})
</script>

<template>
  <div class="home-theme content-stack">
    <BCard class="mb-3 shell-card config-card">
      <BCardBody class="p-3 p-md-4">
        <h5 class="section-heading">Houses</h5>
        <BRow class="g-3">
          <BCol sm="4">
            <BFormGroup label="Small (1 slot)" label-for="house-small">
              <BFormSpinbutton id="house-small" v-model="small" :min="minSmall" />
            </BFormGroup>
          </BCol>
          <BCol sm="4">
            <BFormGroup label="Medium (2 slots)" label-for="house-medium">
              <BFormSpinbutton id="house-medium" v-model="medium" :min="minMedium" />
            </BFormGroup>
          </BCol>
          <BCol sm="4">
            <BFormGroup label="Large (4 slots)" label-for="house-large">
              <BFormSpinbutton id="house-large" v-model="large" :min="minLarge" />
            </BFormGroup>
          </BCol>
        </BRow>
        <h5 class="section-heading">Pokémon</h5>
        <BRow class="mt-1">
          <PokemonSelect
            v-model="selectedPokemon"
            :pokemon-names="pokemonNames"
            :pinned-names="pinStore.allPinnedPokemonNames"
          />
        </BRow>
      </BCardBody>
    </BCard>

    <div class="d-flex gap-2 align-items-start flex-wrap mb-3 action-row">
      <BButton variant="outline-danger" class="beach-button" @click="clearAll"> Clear all </BButton>
      <BButton
        variant="outline-secondary"
        class="beach-button"
        :disabled="pokemonNames.length === 0"
        @click="loadSample"
      >
        Show a sample island
      </BButton>
      <BButton
        variant="outline-primary"
        class="beach-button"
        :disabled="pokemonNames.length === 0"
        @click="openSaveModal"
      >
        Save query
      </BButton>
      (this is saved in local browser storage. None of the data leaves your computer.)
    </div>

    <BAlert v-if="saveSuccess" variant="success" :model-value="true" class="mb-3 status-alert">
      Query saved successfully.
    </BAlert>

    <BModal
      v-model="showSaveModal"
      title="Save query"
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
        />
      </BFormGroup>
    </BModal>

    <BFormGroup
      v-if="savedQueries.length"
      label="Restore saved query"
      label-for="saved-queries-select"
      class="mb-3"
    >
      <BFormSelect
        id="saved-queries-select"
        v-model="selectedTimestamp"
        :options="[
          { value: null, text: 'Select a saved query…' },
          ...savedQueries.map((q) => ({
            value: q.timestamp,
            text: q.title
              ? `${q.title} (${new Date(q.timestamp).toLocaleString()})`
              : new Date(q.timestamp).toLocaleString(),
          })),
        ]"
      />
    </BFormGroup>

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

  <section v-if="result" data-testid="results" class="mt-4 results-section">
    <h2 class="section-heading">Results</h2>

    <BAlert
      v-if="result.unhoused.length"
      variant="warning"
      :model-value="true"
      data-testid="unhoused"
      class="mt-3"
    >
      <h5 class="alert-heading">Unhoused</h5>
      <ul class="mb-0">
        <li v-for="name in result.unhoused" :key="name">{{ name }}</li>
      </ul>
    </BAlert>

    <BListGroup class="w-100 results-list" flush>
      <HouseRecord
        v-for="house in result.houses"
        :key="house.houseId"
        :house="house"
        :pokemon-data="pokemonData!"
      />
    </BListGroup>
  </section>
</template>
