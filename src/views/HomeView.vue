<script setup lang="ts">
import HouseRecord from '@/components/HouseRecord.vue'
import PokemonSelect from '@/components/PokemonSelect.vue'
import { favoritesForItem, itemsForFavorite, loadAdjacencyMap, loadPokemonData } from '@/queries'
import { solve, type AdjacencyMap, type PokemonData, type SolverResult } from '@/solver'
import {
  BAlert,
  BBadge,
  BButton,
  BCard,
  BCardBody,
  BCol,
  BFormGroup,
  BFormInput,
  BFormSpinbutton,
  BFormSelect,
  BListGroup,
  BModal,
  BRow,
  BSpinner,
} from 'bootstrap-vue-next'
import { computed, onMounted, ref, watch } from 'vue'

const pokemonData = ref<PokemonData | null>(null)
const adjacencyMap = ref<AdjacencyMap | null>(null)
const pokemonNames = computed(() =>
  pokemonData.value ? Object.keys(pokemonData.value).sort() : [],
)
const selectedPokemon = ref<string[]>([])

const small = ref(0)
const medium = ref(0)
const large = ref(0)

const totalHouses = computed(() => small.value + medium.value + large.value)

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
}

const STORAGE_KEY = 'pokehousing_saved_queries'

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
const showFavoriteItemsModal = ref(false)

const selectedFavoriteItems = ref<string[]>([])
const selectedFavoriteItemRows = ref<Array<{ item: string; otherFavorites: string[] }>>([])

watch(selectedFavorite, async (newFavorite) => {
  if (!newFavorite) {
    selectedFavoriteItems.value = []
    selectedFavoriteItemRows.value = []
    return
  }
  const items = await itemsForFavorite(newFavorite)
  selectedFavoriteItems.value = items
  const selected = newFavorite.toLowerCase()
  const rows = await Promise.all(
    items.map(async (item) => ({
      item,
      otherFavorites: (await favoritesForItem(item)).filter(
        (favorite) => favorite.toLowerCase() !== selected,
      ),
    })),
  )
  selectedFavoriteItemRows.value = rows
})
function openSaveModal() {
  queryTitle.value = ''
  showSaveModal.value = true
}

function confirmSave() {
  const entry: SavedQuery = {
    title: queryTitle.value.trim(),
    timestamp: Date.now(),
    small: small.value,
    medium: medium.value,
    large: large.value,
    pokemon: [...selectedPokemon.value],
  }
  savedQueries.value = [entry, ...savedQueries.value]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedQueries.value))
  saveSuccess.value = true
  setTimeout(() => {
    saveSuccess.value = false
  }, 3000)
}

function openFavoriteItemsModal(favorite: string) {
  selectedFavorite.value = favorite
  showFavoriteItemsModal.value = true
}

watch(selectedTimestamp, (ts) => {
  if (ts === null) return
  const query = savedQueries.value.find((q) => q.timestamp === ts)
  if (!query) return
  small.value = query.small
  medium.value = query.medium
  large.value = query.large
  selectedPokemon.value = [...query.pokemon]
})

onMounted(async () => {
  pokemonData.value = await loadPokemonData()
  adjacencyMap.value = await loadAdjacencyMap()
})

function loadSample() {
  small.value = 1
  medium.value = 3
  large.value = 2
  const names = pokemonNames.value
  const shuffled = [...names].sort(() => Math.random() - 0.5)
  selectedPokemon.value = shuffled.slice(0, 13)
}

watch(
  [selectedPokemon, small, medium, large, pokemonData, adjacencyMap],
  async () => {
    if (!pokemonData.value || !adjacencyMap.value || totalHouses.value === 0) {
      result.value = null
      return
    }
    loading.value = true
    error.value = ''
    try {
      result.value = await solve(
        selectedPokemon.value,
        { small: small.value, medium: medium.value, large: large.value },
        pokemonData.value,
        adjacencyMap.value,
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
              <BFormSpinbutton id="house-small" v-model="small" min="0" />
            </BFormGroup>
          </BCol>
          <BCol sm="4">
            <BFormGroup label="Medium (2 slots)" label-for="house-medium">
              <BFormSpinbutton id="house-medium" v-model="medium" min="0" />
            </BFormGroup>
          </BCol>
          <BCol sm="4">
            <BFormGroup label="Large (4 slots)" label-for="house-large">
              <BFormSpinbutton id="house-large" v-model="large" min="0" />
            </BFormGroup>
          </BCol>
        </BRow>
        <h5 class="section-heading">Pokémon</h5>
        <BRow class="mt-1">
          <PokemonSelect v-model="selectedPokemon" :pokemon-names="pokemonNames" />
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

    <BModal v-model="showSaveModal" title="Save query" ok-title="Save" @ok="confirmSave">
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
        :key="house.houseIndex"
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
    data-testid="favorite-items-modal"
  >
    <p class="mb-2" data-testid="favorite-items-modal-title">{{ selectedFavorite }}</p>
    <ul v-if="selectedFavoriteItems.length" class="mb-0" data-testid="favorite-items-list">
      <li v-for="row in selectedFavoriteItemRows" :key="row.item" class="d-flex gap-2 flex-wrap">
        <span>{{ row.item }}</span>
        <span
          v-if="row.otherFavorites.length"
          class="d-inline-flex gap-1 flex-wrap"
          data-testid="favorite-item-related-favorites"
        >
          (also fulfills
          <BBadge
            v-for="favorite in row.otherFavorites"
            :key="`${row.item}-${favorite}`"
            variant="secondary"
            pill
            data-testid="favorite-item-related-favorite-pill"
          >
            {{ favorite }}
          </BBadge>
          )
        </span>
      </li>
    </ul>
    <p v-else class="text-muted mb-0" data-testid="favorite-items-empty">
      No items found for this favorite.
    </p>
  </BModal>
</template>
