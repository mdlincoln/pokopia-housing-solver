<script setup lang="ts">
import PokemonCard from '@/components/PokemonCard.vue'
import { clusterItemsByFavorites } from '@/items'
import { rankHouseFavorites, type HouseAssignment, type PokemonData } from '@/solver'
import { BBadge, BCardGroup, BListGroupItem, type ColorVariant } from 'bootstrap-vue-next'
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

const recommendedItems = computed(() => {
  if (sharedFavorites.value.length === 0) return []
  return clusterItemsByFavorites(sharedFavorites.value.map((f) => f.favorite))
})

const HABITAT_VARIANT: Record<string, ColorVariant> = {
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
    <p class="text-muted mb-2">
      <span>Capacity: {{ house.capacity }}</span>
      <span v-if="sharedHabitats.length" class="mt-2" data-testid="shared-habitats">
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
      </span>
      <span v-if="sharedFavorites.length" class="mt-2">
        <BBadge
          v-for="item in sharedFavorites"
          :key="item.favorite"
          variant="info"
          pill
          class="me-1"
        >
          {{ item.favorite }} &times;{{ item.count }}
        </BBadge>
      </span>
    </p>

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

    <details v-if="recommendedItems.length" data-testid="recommended-items" class="mt-2">
      <summary>Recommended items</summary>
      <ol data-testid="recommended-items-list">
        <li v-for="(cluster, ci) in recommendedItems" :key="ci" data-testid="item-cluster">
          {{ cluster.favorites.join(', ') }}
          <ol>
            <li v-for="item in cluster.items" :key="item">{{ item }}</li>
          </ol>
        </li>
      </ol>
    </details>
  </BListGroupItem>
</template>
