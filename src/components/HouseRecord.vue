<script setup lang="ts">
import PokemonCard from '@/components/PokemonCard.vue'
import { rankHouseFavorites, type HouseAssignment, type PokemonData } from '@/solver'
import { BBadge, BCardGroup, BListGroupItem } from 'bootstrap-vue-next'
import { computed } from 'vue'

const props = defineProps<{
  house: HouseAssignment
  pokemonData: PokemonData
}>()

const sharedFavorites = computed(() => {
  if (props.house.pokemon.length < 2) return []
  const sets = props.house.pokemon.map((name) => new Set(props.pokemonData[name]?.favorites ?? []))
  return rankHouseFavorites(sets)
})

const HABITAT_VARIANT: Record<string, string> = {
  Dark: 'dark',
  Bright: 'warning',
  Cool: 'info',
  Warm: 'danger',
  Dry: 'secondary',
  Humid: 'success',
}

const sharedHabitats = computed(() => {
  if (props.house.pokemon.length < 2) return []
  const habitatCounts = new Map<string, number>()
  for (const name of props.house.pokemon) {
    const habitat = props.pokemonData[name]?.habitat
    if (habitat) {
      habitatCounts.set(habitat, (habitatCounts.get(habitat) ?? 0) + 1)
    }
  }
  return Array.from(habitatCounts.entries())
    .filter(([, count]) => count >= 2)
    .map(([habitat, count]) => ({
      habitat,
      count,
      variant: HABITAT_VARIANT[habitat] ?? 'light',
    }))
})
</script>

<template>
  <BListGroupItem data-testid="house-card">
    <h5 class="mb-1">{{ house.size }} house #{{ house.houseIndex }}</h5>
    <p class="text-muted mb-2">Capacity: {{ house.capacity }}</p>
    <div v-if="sharedHabitats.length" class="mt-2" data-testid="shared-habitats">
      <strong>Shared habitats</strong>
      <div class="mt-1">
        <BBadge
          v-for="item in sharedHabitats"
          :key="item.habitat"
          :variant="item.variant"
          pill
          class="me-1"
          data-testid="shared-habitat-badge"
        >
          {{ item.habitat }} &times;{{ item.count }}
        </BBadge>
      </div>
    </div>
    <div v-if="sharedFavorites.length" class="mt-2">
      <strong>Shared interests</strong>
      <div class="mt-1">
        <BBadge
          v-for="item in sharedFavorites"
          :key="item.favorite"
          variant="info"
          pill
          class="me-1"
        >
          {{ item.favorite }} &times;{{ item.count }}
        </BBadge>
      </div>
    </div>
    <BCardGroup v-if="house.pokemon.length > 0">
      <PokemonCard
        v-for="name in house.pokemon"
        :key="name"
        :name="name"
        :image="pokemonData[name]!.image"
        :favorites="pokemonData[name]!.favorites"
        :habitat="pokemonData[name]?.habitat"
      />
    </BCardGroup>
    <p v-else data-testid="empty" class="text-muted fst-italic mb-0">Empty</p>
  </BListGroupItem>
</template>
