<script setup lang="ts">
import { assetPath } from '@/assetPath'
import FavoriteBadge from '@/components/FavoriteBadge.vue'
import PokemonCard from '@/components/PokemonCard.vue'
import { HABITAT_VARIANT } from '@/habitats'
import {
  clusterTaggedItemsForHouse,
  favoritesForItem,
  type ItemCluster,
  type ItemDetails,
} from '@/items'
import { rankHouseFavorites, type HouseAssignment, type PokemonData } from '@/solver'
import { useCartStore } from '@/stores/cart'
import { usePinStore } from '@/stores/pins'
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
const pinStore = usePinStore()
const progressStore = useProgressStore()

const emit = defineEmits<{
  favoriteClicked: [favorite: string, houseId: string]
}>()

function handleFavoriteClick(favorite: string) {
  emit('favoriteClicked', favorite, props.house.houseId)
}

function toggleHousePin() {
  pinStore.toggleHousePin(props.house.houseId, props.house.pokemon)
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
    const allFavorites = pokemon.flatMap((name) => props.pokemonData[name]?.favorites ?? [])
    if (allFavorites.length === 0) {
      recommendedItems.value = []
      return
    }
    recommendedItems.value = await clusterTaggedItemsForHouse(allFavorites)
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

const houseCartItems = computed(() => cartStore.itemsByHouse.get(props.house.houseId) ?? [])

const houseCartItemNames = computed(() => new Set(houseCartItems.value.map((item) => item.name)))

const ITEM_TAGS = ['Relaxation', 'Toy', 'Decoration'] as const

const fulfilledTags = computed(
  () =>
    new Set(
      houseCartItems.value
        .map((item) => item.tag)
        .filter((t): t is string => !!t)
        .map((t) => t.toLowerCase()),
    ),
)

const fulfilledFavorites = ref<Set<string>>(new Set())

watch(
  houseCartItems,
  async (items) => {
    if (items.length === 0) {
      fulfilledFavorites.value = new Set()
      return
    }
    const allFavs = await Promise.all(items.map((item) => favoritesForItem(item.name)))
    fulfilledFavorites.value = new Set(allFavs.flat().map((f) => f.toLowerCase()))
  },
  { deep: true, immediate: true },
)

interface FlatRow {
  favorites: string[]
  item: ItemDetails
  span: number
  isFirst: boolean
}

const flatRows = computed<FlatRow[]>(() => {
  const result: FlatRow[] = []
  for (const cluster of recommendedItems.value) {
    cluster.items.forEach((item, idx) => {
      result.push({
        favorites: cluster.favorites,
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
    :class="{ 'checked-off': pinStore.isHousePinned(house.houseId) }"
  >
    <h5 class="mb-1 house-title">
      <input
        type="checkbox"
        :checked="pinStore.isHousePinned(house.houseId)"
        class="form-check-input me-2"
        data-testid="progress-checkbox-house"
        @change="toggleHousePin"
        title="Pin this house and all its pokemon so they stay when re-solving"
      />
      {{ house.size }} house {{ house.houseId }}
    </h5>
    <h6>House-wide needs</h6>
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
        <FavoriteBadge
          v-for="item in sharedFavorites"
          :key="item.favorite"
          :favorite="item.favorite"
          :fulfilled="fulfilledFavorites.has(item.favorite.toLowerCase())"
          :count="item.count"
          data-testid="shared-favorite-badge"
          @click="handleFavoriteClick"
        />
      </span>
    </p>

    <div class="my-2 d-flex gap-2" data-testid="tag-fulfillment-status">
      <BBadge
        v-for="tag in ITEM_TAGS"
        :key="tag"
        :variant="fulfilledTags.has(tag.toLowerCase()) ? 'success' : 'danger'"
        pill
        :data-testid="`tag-status-${tag.toLowerCase()}`"
      >
        {{ fulfilledTags.has(tag.toLowerCase()) ? '✓' : '✗' }} {{ tag }}
      </BBadge>
    </div>

    <BCardGroup v-if="house.pokemon.length > 0">
      <PokemonCard
        v-for="name in house.pokemon"
        :key="name"
        :name="name"
        :image="pokemonData[name]!.image"
        :favorites="pokemonData[name]!.favorites"
        :habitat="pokemonData[name]?.habitat"
        :checked="pinStore.isPokemonPinned(house.houseId, name)"
        :fulfilled-favorites="fulfilledFavorites"
        @favorite-clicked="handleFavoriteClick"
        @toggle="pinStore.togglePokemonPin(house.houseId, name)"
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
            <BTh></BTh>
            <BTh>Item</BTh>
            <BTh>Craft</BTh>
            <BTh>Category</BTh>
            <BTh>Tag</BTh>
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
              class="align-top"
              data-testid="item-cluster-favorites"
            >
              <FavoriteBadge
                v-for="fav in row.favorites"
                :key="fav"
                :favorite="fav"
                :fulfilled="fulfilledFavorites.has(fav)"
                data-testid="cluster-favorite-badge"
                @click="handleFavoriteClick"
              />
            </BTh>
            <BTd>
              <BButton
                size="sm"
                variant="outline-success"
                class="cart-add-btn"
                data-testid="add-to-cart"
                @click="cartStore.addItem(house.houseId, row.item.name)"
                >+</BButton
              >
            </BTd>
            <BTd class="text-success fw-bold" data-testid="item-in-cart-check">
              {{ houseCartItemNames.has(row.item.name) ? '✓' : '' }}
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
            <BTd>
              <BBadge v-if="row.item.tag" variant="info" pill data-testid="item-tag-badge">{{
                row.item.tag
              }}</BBadge>
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
          :class="{ 'checked-off': progressStore.isCartItemChecked(house.houseId, item.name) }"
          data-testid="house-cart-item"
        >
          <input
            type="checkbox"
            :checked="progressStore.isCartItemChecked(house.houseId, item.name)"
            class="form-check-input"
            data-testid="progress-checkbox-cart-item"
            @change="progressStore.toggleCartItem(house.houseId, item.name)"
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
                house.houseId,
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
