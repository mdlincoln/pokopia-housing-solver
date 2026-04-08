<script setup lang="ts">
import PokemonCard from '@/components/PokemonCard.vue'
import { clusterItemsByFavorites, selectTopNonOverlappingClusters } from '@/items'
import { rankHouseFavorites, type HouseAssignment, type PokemonData } from '@/solver'
import { BBadge, BCardGroup, BListGroupItem, type ColorVariant } from 'bootstrap-vue-next'
import { computed } from 'vue'

const props = defineProps<{
  house: HouseAssignment
  pokemonData: PokemonData
}>()

const emit = defineEmits<{
  favoriteClicked: [favorite: string]
}>()

function handleFavoriteClick(favorite: string) {
  emit('favoriteClicked', favorite)
}

const sharedFavorites = computed(() => {
  if (props.house.pokemon.length < 2) return []
  const sets = props.house.pokemon.map((name) => new Set(props.pokemonData[name]?.favorites ?? []))
  return rankHouseFavorites(sets)
})

const recommendedItems = computed(() => {
  const favorites: string[] = []
  const seen = new Set<string>()
  for (const name of props.house.pokemon) {
    for (const favorite of props.pokemonData[name]?.favorites ?? []) {
      const lower = favorite.toLowerCase()
      if (seen.has(lower)) continue
      seen.add(lower)
      favorites.push(favorite)
    }
  }
  if (favorites.length === 0) return []
  return selectTopNonOverlappingClusters(clusterItemsByFavorites(favorites), 3)
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
  <BListGroupItem class="house-card" data-testid="house-card">
    <h5 class="mb-1 house-title">{{ house.size }} house #{{ house.houseIndex }}</h5>
    <p class="text-muted mb-2 house-meta">
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
          class="me-1 favorite-pill"
          role="button"
          tabindex="0"
          data-testid="shared-favorite-badge"
          @click="handleFavoriteClick(item.favorite)"
          @keydown.enter.prevent="handleFavoriteClick(item.favorite)"
          @keydown.space.prevent="handleFavoriteClick(item.favorite)"
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
        @favorite-clicked="handleFavoriteClick"
      />
    </BCardGroup>
    <p v-else data-testid="empty" class="text-muted fst-italic mb-0">Empty</p>

    <details
      v-if="recommendedItems.length"
      data-testid="recommended-items"
      class="mt-3 house-recommendations"
    >
      <summary>Recommended items</summary>
      <ol data-testid="recommended-items-list">
        <li v-for="(cluster, ci) in recommendedItems" :key="ci" data-testid="item-cluster">
          <span data-testid="item-cluster-favorites">{{ cluster.favorites.join(', ') }}</span>
          <ol>
            <li v-for="item in cluster.items" :key="item">{{ item }}</li>
          </ol>
        </li>
      </ol>
    </details>
  </BListGroupItem>
</template>
