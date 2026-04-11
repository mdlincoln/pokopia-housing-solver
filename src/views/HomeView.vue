<script setup lang="ts">
import HouseRecord from '@/components/HouseRecord.vue'
import PokemonSelect from '@/components/PokemonSelect.vue'
import { assetPath } from '@/assetPath'
import { favoritesForItem, itemsForFavorite } from '@/items'
import { loadAdjacencyMap, loadPokemonData } from '@/queries'
import { solve, type AdjacencyMap, type PokemonData, type SolverResult } from '@/solver'
import { useCartStore } from '@/stores/cart'
import { useHouseStore } from '@/stores/houses'
import { usePinStore } from '@/stores/pins'
import { useProgressStore } from '@/stores/progress'
import {
  BAlert,
  BBadge,
  BButton,
  BCard,
  BCardBody,
  BCol,
  BFormGroup,
  BFormInput,
  BFormSelect,
  BListGroup,
  BModal,
  BRow,
  BSpinner,
  BTableSimple,
  BTbody,
  BTd,
  BTh,
  BThead,
  BTr,
} from 'bootstrap-vue-next'
import { computed, onMounted, ref, watch } from 'vue'

const cartStore = useCartStore()
const houseStore = useHouseStore()
const pinStore = usePinStore()
const progressStore = useProgressStore()

const pokemonData = ref<PokemonData | null>(null)
const adjacencyData = ref<AdjacencyMap | null>(null)
const pokemonNames = computed(() =>
  pokemonData.value ? Object.keys(pokemonData.value).sort() : [],
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

const loading = ref(false)
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
const selectedFavorite = ref('')
const selectedFavoriteHouseId = ref('')
const showFavoriteItemsModal = ref(false)

const selectedFavoriteItems = ref<string[]>([])
const selectedFavoriteItemRows = ref<
  {
    item: string
    picturePath: string | null
    otherFavorites: string[]
    isCraftable: boolean
    category: string | null
    flavorText: string | null
  }[]
>([])

watch(selectedFavorite, async (favorite) => {
  if (!favorite) {
    selectedFavoriteItems.value = []
    selectedFavoriteItemRows.value = []
    return
  }
  const items = await itemsForFavorite(favorite)
  selectedFavoriteItems.value = items.map((d) => d.name)
  const lower = favorite.toLowerCase()
  selectedFavoriteItemRows.value = await Promise.all(
    items.map(async (detail) => ({
      item: detail.name,
      picturePath: detail.picturePath,
      isCraftable: detail.isCraftable,
      category: detail.category,
      flavorText: detail.flavorText,
      otherFavorites: (await favoritesForItem(detail.name)).filter(
        (f) => f.toLowerCase() !== lower,
      ),
    })),
  )
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

function openFavoriteItemsModal(favorite: string, houseId: string) {
  selectedFavorite.value = favorite
  selectedFavoriteHouseId.value = houseId
  showFavoriteItemsModal.value = true
}

async function restoreState(query: SharedState) {
  small.value = query.small
  medium.value = query.medium
  large.value = query.large
  selectedPokemon.value = [...query.pokemon]

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
  const [data, adjacency] = await Promise.all([loadPokemonData(), loadAdjacencyMap()])
  pokemonData.value = data
  adjacencyData.value = adjacency

  const shared = decodeStateFromUrl()
  if (shared) {
    restoringFromUrl = true
    const entry: SavedQuery = {
      title: '',
      timestamp: Date.now(),
      ...shared,
    }
    savedQueries.value = [entry, ...savedQueries.value]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedQueries.value))
    await restoreState(shared)
    restoringFromUrl = false
  }
})

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

function loadSample() {
  pinStore.clear()
  progressStore.restoreProgress({})
  houseStore.clear()
  small.value = 1
  medium.value = 3
  large.value = 2
  houseStore.reconcileHouses({ small: 1, medium: 3, large: 2 }, new Set())
  const names = pokemonNames.value
  const shuffled = [...names].sort(() => Math.random() - 0.5)
  selectedPokemon.value = shuffled.slice(0, 13)
}

watch(
  [
    selectedPokemon,
    small,
    medium,
    large,
    pokemonData,
    adjacencyData,
    () => pinStore.pinnedPokemon,
    () => pinStore.pinnedHouses,
  ],
  async () => {
    if (!pokemonData.value || !adjacencyData.value || totalHouses.value === 0) {
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

    loading.value = true
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
      loading.value = false
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
  selectedFavorite,
  selectedFavoriteItems,
  selectedFavoriteItemRows,
  showFavoriteItemsModal,
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
              <BFormInput id="house-small" v-model.number="small" type="number" :min="minSmall" />
            </BFormGroup>
          </BCol>
          <BCol sm="4">
            <BFormGroup label="Medium (2 slots)" label-for="house-medium">
              <BFormInput
                id="house-medium"
                v-model.number="medium"
                type="number"
                :min="minMedium"
              />
            </BFormGroup>
          </BCol>
          <BCol sm="4">
            <BFormGroup label="Large (4 slots)" label-for="house-large">
              <BFormInput id="house-large" v-model.number="large" type="number" :min="minLarge" />
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
      <BButton
        variant="outline-secondary"
        class="beach-button"
        :disabled="!pokemonData"
        @click="loadSample"
      >
        Show a sample island
      </BButton>
      <BButton
        variant="outline-primary"
        class="beach-button"
        :disabled="!pokemonData"
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
    <BListGroup class="w-100 results-list" flush>
      <HouseRecord
        v-for="house in result.houses"
        :key="house.houseId"
        :house="house"
        :pokemon-data="pokemonData!"
        @favorite-clicked="openFavoriteItemsModal"
      />
    </BListGroup>

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
  </section>

  <BModal
    v-model="showFavoriteItemsModal"
    :title="`Items for ${selectedFavorite}`"
    ok-only
    ok-title="Close"
    ok-variant="primary"
    data-testid="favorite-items-modal"
  >
    <BTableSimple
      v-if="selectedFavoriteItems.length"
      small
      borderless
      class="mb-0"
      data-testid="favorite-items-list"
    >
      <BThead>
        <BTr>
          <BTh></BTh>
          <BTh></BTh>
          <BTh>Item</BTh>
          <BTh>Craft</BTh>
          <BTh>Category</BTh>
          <BTh>Also fulfills</BTh>
        </BTr>
      </BThead>
      <BTbody>
        <BTr v-for="row in selectedFavoriteItemRows" :key="row.item">
          <BTd>
            <BButton
              size="sm"
              variant="outline-success"
              class="cart-add-btn"
              data-testid="add-to-cart"
              @click="cartStore.addItem(selectedFavoriteHouseId, row.item)"
              >+</BButton
            >
          </BTd>
          <BTd class="ps-0">
            <img
              v-if="row.picturePath"
              :src="assetPath(row.picturePath)"
              :alt="row.item"
              class="item-thumbnail"
            />
          </BTd>
          <BTd :title="row.flavorText ?? undefined" data-testid="item-name">{{ row.item }}</BTd>
          <BTd>
            <BBadge
              :variant="row.isCraftable ? 'success' : 'secondary'"
              pill
              data-testid="item-craftable-badge"
              >{{ row.isCraftable ? 'Craft' : 'Buy' }}</BBadge
            >
          </BTd>
          <BTd>
            <BBadge v-if="row.category" variant="warning" pill data-testid="item-category-badge">{{
              row.category
            }}</BBadge>
          </BTd>
          <BTd>
            <span
              v-if="row.otherFavorites.length"
              class="d-inline-flex gap-1 flex-wrap"
              data-testid="favorite-item-related-favorites"
            >
              <BBadge
                v-for="favorite in row.otherFavorites"
                :key="`${row.item}-${favorite}`"
                variant="secondary"
                pill
                data-testid="favorite-item-related-favorite-pill"
                >{{ favorite }}</BBadge
              >
            </span>
          </BTd>
        </BTr>
      </BTbody>
    </BTableSimple>
    <p v-else class="text-muted mb-0" data-testid="favorite-items-empty">
      No items found for this favorite.
    </p>
  </BModal>
</template>
