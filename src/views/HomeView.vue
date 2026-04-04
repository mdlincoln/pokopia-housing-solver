<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import PokemonSelect from '@/components/PokemonSelect.vue'
import { solve, type PokemonData, type SolverResult } from '@/solver'

const pokemonData = ref<PokemonData | null>(null)
const pokemonNames = computed(() =>
  pokemonData.value ? Object.keys(pokemonData.value).sort() : [],
)
const selectedPokemon = ref<string[]>([])

const small = ref(0)
const medium = ref(0)
const large = ref(0)

const loading = ref(false)
const error = ref('')
const result = ref<SolverResult | null>(null)

onMounted(async () => {
  const resp = await fetch('/pokemon_favorites.json')
  const data: PokemonData = await resp.json()
  pokemonData.value = data
})

async function onSubmit() {
  if (!pokemonData.value) return
  loading.value = true
  error.value = ''
  result.value = null
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
}
</script>

<template>
  <form class="solver-form" @submit.prevent="onSubmit">
    <fieldset>
      <legend>Houses</legend>
      <div class="house-inputs">
        <label>
          Small (1 slot)
          <input v-model.number="small" type="number" min="0" />
        </label>
        <label>
          Medium (2 slots)
          <input v-model.number="medium" type="number" min="0" />
        </label>
        <label>
          Large (4 slots)
          <input v-model.number="large" type="number" min="0" />
        </label>
      </div>
    </fieldset>

    <fieldset>
      <legend>Pokemon</legend>
      <PokemonSelect v-model="selectedPokemon" :pokemon-names="pokemonNames" />
    </fieldset>

    <button type="submit" :disabled="loading">
      {{ loading ? 'Solving...' : 'Solve' }}
    </button>
  </form>

  <div v-if="error" class="error" role="alert">{{ error }}</div>

  <section v-if="result" class="results">
    <h2>Results</h2>
    <div class="houses">
      <div v-for="house in result.houses" :key="house.houseIndex" class="house-card">
        <h3>{{ house.size }} house #{{ house.houseIndex }}</h3>
        <p class="capacity">Capacity: {{ house.capacity }}</p>
        <ul v-if="house.pokemon.length">
          <li v-for="name in house.pokemon" :key="name">
            {{ name }}
            <ul v-if="pokemonData?.[name]?.favorites.length" class="favorites">
              <li v-for="fav in pokemonData[name]!.favorites" :key="fav">{{ fav }}</li>
            </ul>
          </li>
        </ul>
        <p v-else class="empty">Empty</p>
      </div>
    </div>
    <div v-if="result.unhoused.length" class="unhoused">
      <h3>Unhoused</h3>
      <ul>
        <li v-for="name in result.unhoused" :key="name">{{ name }}</li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.solver-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

fieldset {
  border: 1px solid #ddd;
  border-radius: 0.5rem;
  padding: 1rem;
}

legend {
  font-weight: 600;
}

.house-inputs {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.house-inputs label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.9rem;
}

.house-inputs input {
  width: 5rem;
  padding: 0.4rem;
  border: 1px solid #ccc;
  border-radius: 0.25rem;
  font-size: 0.9rem;
}

button[type='submit'] {
  align-self: flex-start;
  padding: 0.5rem 1.5rem;
  background: #4f46e5;
  color: white;
  border: none;
  border-radius: 0.25rem;
  font-size: 0.9rem;
  cursor: pointer;
}

button[type='submit']:disabled {
  opacity: 0.6;
  cursor: wait;
}

.error {
  margin-top: 1rem;
  padding: 0.75rem;
  background: #fee2e2;
  color: #b91c1c;
  border-radius: 0.25rem;
}

.results {
  margin-top: 1.5rem;
}

.results h2 {
  font-size: 1.2rem;
  margin-bottom: 0.75rem;
}

.houses {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.house-card {
  border: 1px solid #ddd;
  border-radius: 0.5rem;
  padding: 0.75rem;
  min-width: 150px;
}

.house-card h3 {
  font-size: 0.95rem;
  margin: 0 0 0.25rem;
  text-transform: capitalize;
}

.capacity {
  font-size: 0.8rem;
  color: #666;
  margin: 0 0 0.5rem;
}

.house-card ul {
  margin: 0;
  padding-left: 1.2rem;
}

.house-card li {
  font-size: 0.9rem;
}

.favorites {
  margin: 0.15rem 0 0.25rem;
  padding-left: 1.2rem;
  color: #666;
  font-size: 0.8rem;
}

.empty {
  font-style: italic;
  color: #999;
  margin: 0;
}

.unhoused {
  margin-top: 1rem;
  padding: 0.75rem;
  background: #fef3c7;
  border-radius: 0.5rem;
}

.unhoused h3 {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
}

.unhoused ul {
  margin: 0;
  padding-left: 1.2rem;
}
</style>
