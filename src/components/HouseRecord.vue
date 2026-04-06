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
</script>

<template>
  <BListGroupItem data-testid="house-card">
    <h5 class="mb-1">{{ house.size }} house #{{ house.houseIndex }}</h5>
    <p class="text-muted mb-2">Capacity: {{ house.capacity }}</p>
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
      />
    </BCardGroup>
    <p v-else data-testid="empty" class="text-muted fst-italic mb-0">Empty</p>
  </BListGroupItem>
</template>
