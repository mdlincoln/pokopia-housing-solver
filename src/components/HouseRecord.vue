<script setup lang="ts">
import { assetPath } from '@/assetPath'
import FavoriteBadge from '@/components/FavoriteBadge.vue'
import PokemonCard from '@/components/PokemonCard.vue'
import { HABITAT_VARIANT } from '@/habitats'
import {
  favoriteCoverageColumnKey,
  favoritesForItem,
  recommendedItemsForHouseWithStatus,
  type ItemDetails,
  type RecommendedHouseItemWithStatus,
} from '@/items'
import { rankHouseFavorites, type HouseAssignment, type PokemonData } from '@/solver'
import { useCartStore } from '@/stores/cart'
import { usePinStore } from '@/stores/pins'
import type { BTableSortBy } from 'bootstrap-vue-next'
import { BBadge, BButton, BCardGroup, BListGroupItem, BTable } from 'bootstrap-vue-next'
import { computed, ref, watch, watchEffect } from 'vue'

const props = defineProps<{
  house: HouseAssignment
  pokemonData: PokemonData
}>()

const cartStore = useCartStore()
const pinStore = usePinStore()

function toggleHousePin() {
  pinStore.toggleHousePin(props.house.houseId, props.house.pokemon)
}

const sharedFavorites = computed(() => {
  if (props.house.pokemon.length < 1) return []
  const sets = props.house.pokemon.map((name) => new Set(props.pokemonData[name]?.favorites ?? []))
  return rankHouseFavorites(sets)
})

const sharedHabitats = computed(() => {
  if (props.house.pokemon.length < 1) return []
  const habitatCounts = new Map<string, number>()
  for (const name of props.house.pokemon) {
    const habitat = props.pokemonData[name]?.habitat
    if (habitat) {
      habitatCounts.set(habitat, (habitatCounts.get(habitat) ?? 0) + 1)
    }
  }
  return Array.from(habitatCounts.entries())
    .filter(([, count]) => count >= 1)
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

interface TableItemRow extends Record<string, unknown> {
  itemData: ItemDetails
  name: string
  craftability: string
  tag: string
  _cellVariants?: Record<string, 'success'>
}

const houseFavoriteColumns = computed(() => {
  const freq = new Map<string, number>()
  for (const name of props.house.pokemon) {
    for (const fav of props.pokemonData[name]?.favorites ?? []) {
      const lower = fav.toLowerCase()
      freq.set(lower, (freq.get(lower) ?? 0) + 1)
    }
  }
  return Array.from(freq.entries())
    .map(([favorite, count]) => ({ favorite, count }))
    .sort((a, b) => b.count - a.count || a.favorite.localeCompare(b.favorite))
})

function craftabilityText(item: ItemDetails): string {
  return item.isCraftable ? `Craftable - ${item.category ?? ''}`.trimEnd() : 'Buy'
}

const tableFields = computed(() => [
  { key: 'name', label: 'Item', sortable: true },
  { key: 'col_image', label: '', sortable: false },
  { key: 'col_actions', label: '', sortable: false },
  { key: 'craftability', label: 'Craftability', sortable: true },
  { key: 'tag', label: 'Tag', sortable: true },
  ...houseFavoriteColumns.value.map((col) => ({
    key: favoriteCoverageColumnKey(col.favorite),
    label: col.favorite,
    sortable: true,
    formatter: () => '',
  })),
])

const activeTableItems = ref<TableItemRow[]>([])

const redundantTableItems = ref<TableItemRow[]>([])

async function loadFulfilledFavoriteSet(items: { name: string }[]): Promise<Set<string>> {
  if (items.length === 0) {
    return new Set()
  }

  const allFavs = await Promise.all(items.map((item) => favoritesForItem(item.name)))
  return new Set(allFavs.flat().map((favorite) => favorite.toLowerCase()))
}

function buildTableRow(item: RecommendedHouseItemWithStatus): TableItemRow {
  const row: TableItemRow = {
    itemData: item,
    name: item.name,
    craftability: craftabilityText(item),
    tag: item.tag ?? '',
  }
  const cellVariants: Record<string, 'success'> = {}
  for (const col of houseFavoriteColumns.value) {
    const cellKey = favoriteCoverageColumnKey(col.favorite)
    const isCovered = item[cellKey] === true
    row[cellKey] = isCovered
    if (isCovered) {
      cellVariants[cellKey] = 'success'
    }
  }
  if (Object.keys(cellVariants).length > 0) {
    row._cellVariants = cellVariants
  }
  return row
}

let recommendationRun = 0

watch(
  [() => props.house.pokemon, houseCartItems],
  async ([pokemon, items]) => {
    const run = ++recommendationRun
    const fulfilledFavoriteSet = await loadFulfilledFavoriteSet(items)

    if (run !== recommendationRun) {
      return
    }

    fulfilledFavorites.value = fulfilledFavoriteSet

    const allFavorites = pokemon.flatMap((name) => props.pokemonData[name]?.favorites ?? [])
    if (allFavorites.length === 0) {
      activeTableItems.value = []
      redundantTableItems.value = []
      return
    }

    const representedTags = items
      .map((item) => item.tag)
      .filter((tag): tag is string => !!tag)
      .map((tag) => tag.toLowerCase())

    const recommendations = await recommendedItemsForHouseWithStatus(
      allFavorites,
      Array.from(fulfilledFavoriteSet),
      representedTags,
    )

    if (run !== recommendationRun) {
      return
    }

    const activeRows: TableItemRow[] = []
    const redundantRows: TableItemRow[] = []
    for (const recommendation of recommendations) {
      const row = buildTableRow(recommendation)
      if (recommendation.isRedundant) {
        redundantRows.push(row)
      } else {
        activeRows.push(row)
      }
    }

    activeTableItems.value = activeRows
    redundantTableItems.value = redundantRows
  },
  { deep: true, immediate: true },
)

const sortBy = ref<BTableSortBy[]>([])

watchEffect(() => {
  const cols = houseFavoriteColumns.value
  if (sortBy.value.length === 0 && cols.length > 0) {
    sortBy.value = [{ key: favoriteCoverageColumnKey(cols[0]!.favorite), order: 'desc' }]
  }
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
        @toggle="pinStore.togglePokemonPin(house.houseId, name)"
      />
    </BCardGroup>
    <p v-else data-testid="empty" class="text-muted fst-italic mb-0">Empty</p>

    <details
      v-if="activeTableItems.length || redundantTableItems.length"
      data-testid="recommended-items"
      class="mt-3 house-recommendations"
    >
      <summary>Recommended items</summary>
      <p v-if="activeTableItems.length === 0" class="text-muted fst-italic mb-2">
        All recommended favorites and tags are already covered for this house.
      </p>
      <BTable
        v-if="activeTableItems.length"
        small
        :fields="tableFields"
        :items="activeTableItems"
        v-model:sort-by="sortBy"
        data-testid="recommended-items-list"
      >
        <template #cell(col_image)="{ item }">
          <img
            v-if="(item as any).itemData.picturePath"
            :src="assetPath((item as any).itemData.picturePath)"
            :alt="(item as any).itemData.name"
            class="item-thumbnail"
          />
        </template>

        <template #cell(col_actions)="{ item }">
          <BButton
            size="sm"
            variant="outline-success"
            class="cart-add-btn"
            data-testid="add-to-cart"
            @click="cartStore.addItem(house.houseId, (item as any).itemData.name)"
            >+</BButton
          >
          <span class="text-success fw-bold ms-1" data-testid="item-in-cart-check">
            {{ houseCartItemNames.has((item as any).itemData.name) ? '✓' : '' }}
          </span>
        </template>

        <template #cell(name)="{ item }">
          <span :title="(item as any).itemData.flavorText ?? undefined" data-testid="item-name">{{
            (item as any).itemData.name
          }}</span>
        </template>

        <template #cell(craftability)="{ item }">
          <span data-testid="item-craftability">{{ (item as any).craftability }}</span>
        </template>

        <template #cell(tag)="{ item }">
          <BBadge
            v-if="(item as any).itemData.tag"
            variant="info"
            pill
            data-testid="item-tag-badge"
            >{{ (item as any).itemData.tag }}</BBadge
          >
        </template>
      </BTable>

      <details v-if="redundantTableItems.length" class="mt-3" data-testid="redundant-items-section">
        <summary><h6 class="mb-2">Already covered</h6></summary>
        <p class="mb-2 small">
          These items would not add any new favorite coverage or tag coverage for this house.
        </p>
        <BTable
          small
          :fields="tableFields"
          :items="redundantTableItems"
          data-testid="redundant-items-list"
          class="text-body-secondary opacity-50"
        >
          <template #cell(col_image)="{ item }">
            <img
              v-if="(item as any).itemData.picturePath"
              :src="assetPath((item as any).itemData.picturePath)"
              :alt="(item as any).itemData.name"
              class="item-thumbnail"
            />
          </template>

          <template #cell(col_actions)="{ item }">
            <BButton
              size="sm"
              variant="outline-success"
              class="cart-add-btn"
              data-testid="add-to-cart"
              @click="cartStore.addItem(house.houseId, (item as any).itemData.name)"
              >+</BButton
            >
            <span class="text-success fw-bold ms-1" data-testid="item-in-cart-check">
              {{ houseCartItemNames.has((item as any).itemData.name) ? '✓' : '' }}
            </span>
          </template>

          <template #cell(name)="{ item }">
            <span :title="(item as any).itemData.flavorText ?? undefined" data-testid="item-name">{{
              (item as any).itemData.name
            }}</span>
          </template>

          <template #cell(craftability)="{ item }">
            <span data-testid="item-craftability">{{ (item as any).craftability }}</span>
          </template>

          <template #cell(tag)="{ item }">
            <BBadge
              v-if="(item as any).itemData.tag"
              variant="info"
              pill
              data-testid="item-tag-badge"
              >{{ (item as any).itemData.tag }}</BBadge
            >
          </template>
        </BTable>
      </details>
    </details>
  </BListGroupItem>
</template>
