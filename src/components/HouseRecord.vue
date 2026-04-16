<script setup lang="ts">
import { assetPath } from '@/assetPath'
import PokemonCard from '@/components/PokemonCard.vue'
import { HABITAT_VARIANT } from '@/habitats'
import {
  favoriteCoverageColumnKey,
  favoritesForItem,
  recommendedItemsForHouse,
  type ItemDetails,
  type RecommendedHouseItem,
} from '@/items'
import { type HouseAssignment, type PokemonData } from '@/solver'
import { useCartStore, type CartItem } from '@/stores/cart'
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
  col_toy: boolean
  col_relaxation: boolean
  col_decoration: boolean
  _cellVariants?: Record<string, 'success'>
}

interface CartTableItemRow extends Record<string, unknown> {
  itemData: CartItem
  name: string
  col_toy: boolean
  col_relaxation: boolean
  col_decoration: boolean
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

const unfulfilledFavoriteColumns = computed(() => {
  const fulfilled = fulfilledFavorites.value
  return houseFavoriteColumns.value.filter((col) => !fulfilled.has(col.favorite.toLowerCase()))
})

const recommendationTableFields = computed(() => [
  { key: 'name', label: 'Item', sortable: true, class: 'text-col' },
  { key: 'col_image', label: '', sortable: false },
  { key: 'col_actions', label: '', sortable: false },
  { key: 'craftability', label: 'Craftability', sortable: true, class: 'text-col' },
  ...(!fulfilledTags.value.has('toy')
    ? [{ key: 'col_toy', label: 'Toy', sortable: true, class: 'bool-col' }]
    : []),
  ...(!fulfilledTags.value.has('relaxation')
    ? [{ key: 'col_relaxation', label: 'Relaxation', sortable: true, class: 'bool-col' }]
    : []),
  ...(!fulfilledTags.value.has('decoration')
    ? [{ key: 'col_decoration', label: 'Decoration', sortable: true, class: 'bool-col' }]
    : []),
  ...unfulfilledFavoriteColumns.value.map((col) => ({
    key: favoriteCoverageColumnKey(col.favorite),
    label: col.favorite,
    sortable: true,
    class: 'bool-col',
    count: col.count,
  })),
])

function craftabilityText(item: ItemDetails): string {
  return item.isCraftable ? `Craftable - ${item.category ?? ''}`.trimEnd() : 'Buy'
}

const cartTableFields = computed(() => [
  { key: 'col_image', label: '' },
  { key: 'name', label: 'Item', class: 'text-col' },
  { key: 'col_actions', label: '' },
  { key: 'col_toy', label: 'Toy', class: 'bool-col' },
  { key: 'col_relaxation', label: 'Relaxation', class: 'bool-col' },
  { key: 'col_decoration', label: 'Decoration', class: 'bool-col' },
  ...houseFavoriteColumns.value.map((col) => ({
    key: favoriteCoverageColumnKey(col.favorite),
    label: col.favorite,
    class: 'bool-col',
    count: col.count,
  })),
])

const activeTableItems = ref<TableItemRow[]>([])
const cartTableItems = ref<CartTableItemRow[]>([])

function buildTableRow(item: RecommendedHouseItem): TableItemRow {
  const row: TableItemRow = {
    itemData: item,
    name: item.name,
    craftability: craftabilityText(item),
    col_toy: item.tag?.toLowerCase() === 'toy',
    col_relaxation: item.tag?.toLowerCase() === 'relaxation',
    col_decoration: item.tag?.toLowerCase() === 'decoration',
  }
  const cellVariants: Record<string, 'success'> = {}
  if (row.col_toy) cellVariants['col_toy'] = 'success'
  if (row.col_relaxation) cellVariants['col_relaxation'] = 'success'
  if (row.col_decoration) cellVariants['col_decoration'] = 'success'
  for (const col of unfulfilledFavoriteColumns.value) {
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

function buildCartRow(item: CartItem, itemFavs: string[]): CartTableItemRow {
  const favSet = new Set(itemFavs.map((f) => f.toLowerCase()))
  const row: CartTableItemRow = {
    itemData: item,
    name: item.name,
    col_toy: item.tag?.toLowerCase() === 'toy',
    col_relaxation: item.tag?.toLowerCase() === 'relaxation',
    col_decoration: item.tag?.toLowerCase() === 'decoration',
  }
  const cellVariants: Record<string, 'success'> = {}
  for (const col of houseFavoriteColumns.value) {
    const cellKey = favoriteCoverageColumnKey(col.favorite)
    const isCovered = favSet.has(col.favorite.toLowerCase())
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

    // Fetch favorites for all cart items in one pass — used for both the
    // aggregate fulfilled set and the per-row cart coverage table.
    const allFavsPerItem =
      items.length > 0 ? await Promise.all(items.map((item) => favoritesForItem(item.name))) : []

    if (run !== recommendationRun) return

    const fulfilledFavoriteSet = new Set(
      allFavsPerItem.flat().map((favorite) => favorite.toLowerCase()),
    )
    fulfilledFavorites.value = fulfilledFavoriteSet
    cartTableItems.value = items.map((item, i) => buildCartRow(item, allFavsPerItem[i]!))

    const allFavorites = pokemon.flatMap((name) => props.pokemonData[name]?.favorites ?? [])
    const unfulfilledFavorites = allFavorites.filter(
      (favorite) => !fulfilledFavoriteSet.has(favorite.toLowerCase()),
    )
    const queryFavorites = unfulfilledFavorites.length > 0 ? unfulfilledFavorites : allFavorites

    if (queryFavorites.length === 0) {
      activeTableItems.value = []
      return
    }

    const recommendations = await recommendedItemsForHouse(queryFavorites)

    if (run !== recommendationRun) return

    activeTableItems.value = recommendations.map((r) => buildTableRow(r))
  },
  { deep: true, immediate: true },
)

const sortBy = ref<BTableSortBy[]>([])

watchEffect(() => {
  const cols = unfulfilledFavoriteColumns.value
  const firstKey = cols.length > 0 ? favoriteCoverageColumnKey(cols[0]!.favorite) : undefined

  if (sortBy.value.length === 0 && firstKey) {
    sortBy.value = [{ key: firstKey, order: 'desc' }]
    return
  }

  if (sortBy.value.length > 0 && firstKey && sortBy.value[0]!.key !== firstKey) {
    sortBy.value = [{ key: firstKey, order: 'desc' }]
  }

  if (sortBy.value.length > 0 && !firstKey) {
    sortBy.value = []
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
      <button
        type="button"
        role="checkbox"
        :aria-checked="pinStore.isHousePinned(house.houseId)"
        class="btn btn-link p-0 me-2 pin-icon"
        data-testid="progress-checkbox-house"
        @click="toggleHousePin"
        title="Pin this house and all its pokemon so they stay when re-solving"
      >
        <i :class="pinStore.isHousePinned(house.houseId) ? 'bi bi-lock-fill' : 'bi bi-unlock'"></i>
      </button>
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
    </p>

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

    <div v-if="cartTableItems.length" class="mt-3" data-testid="cart-items-coverage">
      <h6>Items in cart</h6>
      <BTable
        sticky-header="250px"
        no-border-collapse
        small
        responsive
        class="recommended-items-table"
        :fields="cartTableFields"
        :items="cartTableItems"
        data-testid="cart-coverage-table"
      >
        <template #head()="{ column, label, field }">
          <template v-if="(column as string).startsWith('fav_')">
            <span
              v-if="label"
              :class="
                fulfilledFavorites.has((label as string).toLowerCase())
                  ? 'text-success fw-bold'
                  : 'text-danger'
              "
              :data-testid="`fav-header-${column}`"
            >
              {{ label }} &times;{{ (field as any).count }}
            </span>
          </template>
          <template
            v-else-if="
              column === 'col_toy' || column === 'col_relaxation' || column === 'col_decoration'
            "
          >
            <span
              v-if="label"
              :class="
                fulfilledTags.has((label as string).toLowerCase())
                  ? 'text-success fw-bold'
                  : 'text-danger'
              "
            >
              {{ label }}
            </span>
          </template>
          <template v-else
            ><span>{{ label }}</span></template
          >
        </template>

        <template #cell(col_image)="{ item }">
          <img
            v-if="(item as any).itemData.picturePath"
            :src="assetPath((item as any).itemData.picturePath)"
            :alt="(item as any).itemData.name"
            class="item-thumbnail"
          />
        </template>

        <template #cell(name)="{ item }">
          <span :title="(item as any).itemData.flavorText ?? undefined" data-testid="item-name">{{
            (item as any).itemData.name
          }}</span>
        </template>

        <template #cell(col_actions)="{ item }">
          <BButton
            size="sm"
            variant="outline-danger"
            data-testid="cart-coverage-remove"
            @click="cartStore.removeItem(house.houseId, (item as any).itemData.name)"
            >&times;</BButton
          >
        </template>

        <template #cell(col_toy)="{ value }">
          <span v-if="value" class="bool-check" data-testid="cart-tag-toy">✓</span>
        </template>

        <template #cell(col_relaxation)="{ value }">
          <span v-if="value" class="bool-check" data-testid="cart-tag-relaxation">✓</span>
        </template>

        <template #cell(col_decoration)="{ value }">
          <span v-if="value" class="bool-check" data-testid="cart-tag-decoration">✓</span>
        </template>

        <template #cell()="{ field, value }">
          <span v-if="(field as any).class === 'bool-col' && value" class="bool-check">✓</span>
        </template>
      </BTable>
    </div>

    <details
      v-if="activeTableItems.length"
      data-testid="recommended-items"
      class="mt-3 house-recommendations"
    >
      <summary>Recommended items</summary>
      <p v-if="activeTableItems.length === 0" class="text-muted fst-italic mb-2">
        All recommended favorites and tags are already covered for this house.
      </p>
      <BTable
        v-if="activeTableItems.length"
        sticky-header="400px"
        no-border-collapse
        small
        responsive
        class="recommended-items-table"
        :fields="recommendationTableFields"
        :items="activeTableItems"
        v-model:sort-by="sortBy"
        data-testid="recommended-items-list"
      >
        <template #head()="{ column, label, field }">
          <template v-if="(column as string).startsWith('fav_')">
            <span
              :class="
                fulfilledFavorites.has((label as string).toLowerCase())
                  ? 'text-success fw-bold'
                  : 'text-danger'
              "
            >
              {{ label }} &times;{{ (field as any).count }}
            </span>
          </template>
          <template
            v-else-if="
              column === 'col_toy' || column === 'col_relaxation' || column === 'col_decoration'
            "
          >
            <span
              :class="
                fulfilledTags.has((label as string).toLowerCase())
                  ? 'text-success fw-bold'
                  : 'text-danger'
              "
            >
              {{ label }}
            </span>
          </template>
          <template v-else
            ><span>{{ label }}</span></template
          >
        </template>

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

        <template #cell()="{ field, value }">
          <span v-if="(field as any).class === 'bool-col' && value" class="bool-check">✓</span>
        </template>
      </BTable>
    </details>
  </BListGroupItem>
</template>
