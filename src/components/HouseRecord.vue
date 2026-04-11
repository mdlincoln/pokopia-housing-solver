<script setup lang="ts">
import { assetPath } from '@/assetPath'
import PokemonCard from '@/components/PokemonCard.vue'
import { HABITAT_VARIANT } from '@/habitats'
import {
  clusterItemsByFavorites,
  selectTopNonOverlappingClusters,
  type ItemCluster,
  type ItemDetails,
} from '@/items'
import { rankHouseFavorites, type HouseAssignment, type PokemonData } from '@/solver'
import { useCartStore } from '@/stores/cart'
import { useProgressStore } from '@/stores/progress'
import {
  BBadge,
  BButton,
  BCardGroup,
  BListGroup,
  BListGroupItem,
  BTableSimple,
  BTbody,
  BTd,
  BTh,
  BThead,
  BTr,
} from 'bootstrap-vue-next'
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  house: HouseAssignment
  pokemonData: PokemonData
}>()

const cartStore = useCartStore()
const progressStore = useProgressStore()

const emit = defineEmits<{
  favoriteClicked: [favorite: string, houseIndex: number]
}>()

function handleFavoriteClick(favorite: string) {
  emit('favoriteClicked', favorite, props.house.houseIndex)
}

const sharedFavorites = computed(() => {
  if (props.house.pokemon.length < 2) return []
  const sets = props.house.pokemon.map((name) => new Set(props.pokemonData[name]?.favorites ?? []))
  return rankHouseFavorites(sets)
})

const recommendedItems = ref<ItemCluster[]>([])

watch(
  () => props.house.pokemon,
  async (pokemon) => {
    const favorites = pokemon.flatMap((name) => props.pokemonData[name]?.favorites ?? [])
    if (favorites.length === 0) {
      recommendedItems.value = []
      return
    }
    const clusters = await clusterItemsByFavorites(favorites)
    recommendedItems.value = await selectTopNonOverlappingClusters(clusters, 3)
  },
  { deep: true, immediate: true },
)

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

const houseCartItems = computed(() => cartStore.itemsByHouse.get(props.house.houseIndex) ?? [])

interface FlatRow {
  favorites: string
  item: ItemDetails
  span: number
  isFirst: boolean
}

const flatRows = computed<FlatRow[]>(() => {
  const result: FlatRow[] = []
  for (const cluster of recommendedItems.value) {
    cluster.items.forEach((item, idx) => {
      result.push({
        favorites: cluster.favorites.join(', '),
        item,
        span: cluster.items.length,
        isFirst: idx === 0,
      })
    })
  }
  return result
})
</script>

<template>
  <BListGroupItem
    class="house-card"
    data-testid="house-card"
    :class="{ 'checked-off': progressStore.isHouseChecked(house.houseIndex) }"
  >
    <h5 class="mb-1 house-title">
      <input
        type="checkbox"
        :checked="progressStore.isHouseChecked(house.houseIndex)"
        class="form-check-input me-2"
        data-testid="progress-checkbox-house"
        @change="progressStore.toggleHouse(house.houseIndex)"
        title="Checkbox to keep track of your progress building and housing your Pokemon"
      />
      {{ house.size }} house #{{ house.houseIndex }}
    </h5>
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
        :checked="progressStore.isPokemonChecked(house.houseIndex, name)"
        @favorite-clicked="handleFavoriteClick"
        @toggle="progressStore.togglePokemon(house.houseIndex, name)"
      />
    </BCardGroup>
    <p v-else data-testid="empty" class="text-muted fst-italic mb-0">Empty</p>

    <details
      v-if="recommendedItems.length"
      data-testid="recommended-items"
      class="mt-3 house-recommendations"
    >
      <summary>Recommended items</summary>
      <BTableSimple small borderless data-testid="recommended-items-list">
        <BThead>
          <BTr>
            <BTh>Favorites</BTh>
            <BTh></BTh>
            <BTh></BTh>
            <BTh>Item</BTh>
            <BTh>Craft</BTh>
            <BTh>Category</BTh>
          </BTr>
        </BThead>
        <BTbody>
          <BTr
            v-for="(row, i) in flatRows"
            :key="i"
            :class="{ 'row-group-start': row.isFirst && i > 0 }"
            :data-testid="row.isFirst ? 'item-cluster' : undefined"
          >
            <BTh
              v-if="row.isFirst"
              :rowspan="row.span"
              class="align-top text-muted fw-normal small"
              data-testid="item-cluster-favorites"
              >{{ row.favorites }}</BTh
            >
            <BTd>
              <BButton
                size="sm"
                variant="outline-success"
                class="cart-add-btn"
                data-testid="add-to-cart"
                @click="cartStore.addItem(house.houseIndex, row.item.name)"
                >+</BButton
              >
            </BTd>
            <BTd class="ps-0">
              <img
                v-if="row.item.picturePath"
                :src="assetPath(row.item.picturePath)"
                :alt="row.item.name"
                class="item-thumbnail"
              />
            </BTd>
            <BTd :title="row.item.flavorText ?? undefined" data-testid="item-name">
              {{ row.item.name }}
            </BTd>
            <BTd>
              <BBadge
                :variant="row.item.isCraftable ? 'success' : 'secondary'"
                pill
                data-testid="item-craftable-badge"
                >{{ row.item.isCraftable ? 'Craft' : 'Buy' }}</BBadge
              >
            </BTd>
            <BTd>
              <BBadge
                v-if="row.item.category"
                variant="warning"
                pill
                data-testid="item-category-badge"
                >{{ row.item.category }}</BBadge
              >
            </BTd>
          </BTr>
        </BTbody>
      </BTableSimple>
    </details>

    <div v-if="houseCartItems.length" class="mt-3" data-testid="house-cart-items">
      <h6 class="text-muted small mb-2">Shopping list</h6>
      <BListGroup flush>
        <BListGroupItem
          v-for="item in houseCartItems"
          :key="item.name"
          class="d-flex align-items-center gap-2 py-1 px-0"
          :class="{ 'checked-off': progressStore.isCartItemChecked(house.houseIndex, item.name) }"
          data-testid="house-cart-item"
        >
          <input
            type="checkbox"
            :checked="progressStore.isCartItemChecked(house.houseIndex, item.name)"
            class="form-check-input"
            data-testid="progress-checkbox-cart-item"
            @change="progressStore.toggleCartItem(house.houseIndex, item.name)"
          />
          <img
            v-if="item.picturePath"
            :src="assetPath(item.picturePath)"
            :alt="item.name"
            class="item-thumbnail"
          />
          <span
            :class="{
              'text-decoration-line-through': progressStore.isCartItemChecked(
                house.houseIndex,
                item.name,
              ),
            }"
          >
            {{ item.quantity }}&times; {{ item.name }}
          </span>
        </BListGroupItem>
      </BListGroup>
    </div>
  </BListGroupItem>
</template>
