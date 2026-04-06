<script setup lang="ts">
import HouseRecord from '@/components/HouseRecord.vue'
import PokemonSelect from '@/components/PokemonSelect.vue'
import { solve, type PokemonData, type SolverResult } from '@/solver'
import {
  BAlert,
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
} from 'bootstrap-vue-next'
import { computed, onMounted, ref, watch } from 'vue'

const pokemonData = ref<PokemonData | null>(null)
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
  const resp = await fetch('/pokemon_favorites.json')
  const data: PokemonData = await resp.json()
  pokemonData.value = data
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
  [selectedPokemon, small, medium, large, pokemonData],
  async () => {
    if (!pokemonData.value || totalHouses.value === 0) {
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
      )
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Solver failed'
    } finally {
      loading.value = false
    }
  },
  { deep: true },
)

defineExpose({ small, medium, large, selectedPokemon, queryTitle, confirmSave })
</script>

<template>
  <div>
    <BCard class="mb-3">
      <BCardBody>
        <h5 class="card-title">Houses</h5>
        <BRow>
          <BCol sm="4">
            <BFormGroup label="Small (1 slot)" label-for="house-small">
              <BFormInput id="house-small" v-model.number="small" type="number" min="0" />
            </BFormGroup>
          </BCol>
          <BCol sm="4">
            <BFormGroup label="Medium (2 slots)" label-for="house-medium">
              <BFormInput id="house-medium" v-model.number="medium" type="number" min="0" />
            </BFormGroup>
          </BCol>
          <BCol sm="4">
            <BFormGroup label="Large (4 slots)" label-for="house-large">
              <BFormInput id="house-large" v-model.number="large" type="number" min="0" />
            </BFormGroup>
          </BCol>
        </BRow>
      </BCardBody>
    </BCard>

    <BCard class="mb-3">
      <BCardBody>
        <h5 class="card-title">Pokemon</h5>
        <PokemonSelect v-model="selectedPokemon" :pokemon-names="pokemonNames" />
      </BCardBody>
    </BCard>

    <div class="d-flex gap-2 align-items-start flex-wrap mb-2">
      <BButton variant="outline-secondary" :disabled="!pokemonData" @click="loadSample">
        Show a sample island
      </BButton>
      <BButton variant="outline-primary" :disabled="!pokemonData" @click="openSaveModal">
        Save query
      </BButton>
    </div>

    <BAlert v-if="saveSuccess" variant="success" :model-value="true" class="mb-2">
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
      class="mb-2"
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

    <BSpinner v-if="loading" class="my-2" />
  </div>

  <BAlert v-if="error" variant="danger" :model-value="true" data-testid="error" class="mt-3">
    {{ error }}
  </BAlert>

  <section v-if="result" data-testid="results" class="mt-4">
    <h2>Results</h2>
    <BListGroup class="w-100" flush>
      <HouseRecord
        v-for="house in result.houses"
        :key="house.houseIndex"
        :house="house"
        :pokemon-data="pokemonData!"
      />
    </BListGroup>

    <BAlert
      v-if="result.unhoused.length"
      variant="warning"
      :model-value="true"
      data-testid="unhoused"
    >
      <h5 class="alert-heading">Unhoused</h5>
      <ul class="mb-0">
        <li v-for="name in result.unhoused" :key="name">{{ name }}</li>
      </ul>
    </BAlert>
  </section>
</template>
