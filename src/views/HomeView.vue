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
  BListGroup,
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

    <BButton variant="outline-secondary" class="mb-2" :disabled="!pokemonData" @click="loadSample">
      Show a sample island
    </BButton>

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
