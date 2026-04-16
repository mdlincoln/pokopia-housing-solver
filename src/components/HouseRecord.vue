<script setup lang="ts">
import { assetPath } from '@/assetPath'
import PokemonCard from '@/components/PokemonCard.vue'
import { HABITAT_VARIANT } from '@/habitats'
import {
  favoriteCoverageColumnKey,
  favoritesForItem,
  recommendedItemsForHouseWithStatus,
  type ItemDetails,
  type RecommendedHouseItemWithStatus,
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

function craftabilityText(item: ItemDetails): string {
  return item.isCraftable ? `Craftable - ${item.category ?? ''}`.trimEnd() : 'Buy'
}

const tableFields = computed(() => [
  { key: 'name', label: 'Item', sortable: true },
  { key: 'col_image', label: '', sortable: false },
  { key: 'col_actions', label: '', sortable: false },
  { key: 'craftability', label: 'Craftability', sortable: true },
  { key: 'col_toy', label: 'Toy', sortable: true },
  { key: 'col_relaxation', label: 'Relaxation', sortable: true },
  { key: 'col_decoration', label: 'Decoration', sortable: true },
  ...houseFavoriteColumns.value.map((col) => ({
    key: favoriteCoverageColumnKey(col.favorite),
    label: col.favorite,
    sortable: true,
    formatter: () => '',
    count: col.count,
  })),
])

const cartTableFields = computed(() => [
  { key: 'col_image', label: '' },
  { key: 'name', label: 'Item' },
  { key: 'col_actions', label: '' },
  { key: 'col_toy', label: 'Toy' },
  { key: 'col_relaxation', label: 'Relaxation' },
  { key: 'col_decoration', label: 'Decoration' },
  ...houseFavoriteColumns.value.map((col) => ({
    key: favoriteCoverageColumnKey(col.favorite),
    label: col.favorite,
    formatter: () => '',
    count: col.count,
  })),
])

const activeTableItems = ref<TableItemRow[]>([])
const redundantTableItems = ref<TableItemRow[]>([])
const cartTableItems = ref<CartTableItemRow[]>([])

function buildTableRow(item: RecommendedHouseItemWithStatus): TableItemRow {
  const row: TableItemRow = {
    itemData: item,
    name: item.name,
    craftability: craftabilityText(item),
    col_toy: item.tag?.toLowerCase() === 'toy',
    col_relaxation: item.tag?.toLowerCase() === 'relaxation',
    col_decoration: item.tag?.toLowerCase() === 'decoration',
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

    if (run !== recommendationRun) return

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
        :fields="cartTableFields"
        :items="cartTableItems"
        data-testid="cart-coverage-table"
      >
        <template #head()="{ column, label, field }">
          <template v-if="column.startsWith('fav_')">
            <span
              :class="
                fulfilledFavorites.has(label.toLowerCase()) ? 'text-success fw-bold' : 'text-danger'
              "
              :data-testid="`fav-header-${column}`"
            >
              {{ fulfilledFavorites.has(label.toLowerCase()) ? '✓' : '✗' }}
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
                fulfilledTags.has(label.toLowerCase()) ? 'text-success fw-bold' : 'text-danger'
              "
            >
              {{ fulfilledTags.has(label.toLowerCase()) ? '✓' : '✗' }} {{ label }}
            </span>
          </template>
          <template v-else>{{ label }}</template>
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
          <span v-if="value" class="text-success" data-testid="cart-tag-toy">✓</span>
        </template>

        <template #cell(col_relaxation)="{ value }">
          <span v-if="value" class="text-success" data-testid="cart-tag-relaxation">✓</span>
        </template>

        <template #cell(col_decoration)="{ value }">
          <span v-if="value" class="text-success" data-testid="cart-tag-decoration">✓</span>
        </template>
      </BTable>
    </div>

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
        sticky-header="400px"
        no-border-collapse
        small
        responsive
        :fields="tableFields"
        :items="activeTableItems"
        v-model:sort-by="sortBy"
        data-testid="recommended-items-list"
      >
        <template #head()="{ column, label, field }">
          <template v-if="column.startsWith('fav_')">
            <span
              :class="
                fulfilledFavorites.has(label.toLowerCase()) ? 'text-success fw-bold' : 'text-danger'
              "
            >
              {{ fulfilledFavorites.has(label.toLowerCase()) ? '✓' : '✗' }}
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
                fulfilledTags.has(label.toLowerCase()) ? 'text-success fw-bold' : 'text-danger'
              "
            >
              {{ fulfilledTags.has(label.toLowerCase()) ? '✓' : '✗' }} {{ label }}
            </span>
          </template>
          <template v-else>{{ label }}</template>
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

        <template #cell(col_toy)="{ value }">
          <span v-if="value" class="text-success">✓</span>
        </template>

        <template #cell(col_relaxation)="{ value }">
          <span v-if="value" class="text-success">✓</span>
        </template>

        <template #cell(col_decoration)="{ value }">
          <span v-if="value" class="text-success">✓</span>
        </template>
      </BTable>

      <details v-if="redundantTableItems.length" class="mt-3" data-testid="redundant-items-section">
        <summary><h6 class="mb-2">Already covered</h6></summary>
        <p class="mb-2 small">
          These items would not add any new favorite coverage or tag coverage for this house.
        </p>
        <BTable
          small
          responsive
          sticky-header="400px"
          no-border-collapse
          :fields="tableFields"
          :items="redundantTableItems"
          data-testid="redundant-items-list"
          class="text-body-secondary opacity-50"
        >
          <template #head()="{ column, label, field }">
            <template v-if="column.startsWith('fav_')">
              <span
                :class="
                  fulfilledFavorites.has(label.toLowerCase())
                    ? 'text-success fw-bold'
                    : 'text-danger'
                "
              >
                {{ fulfilledFavorites.has(label.toLowerCase()) ? '✓' : '✗' }}
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
                  fulfilledTags.has(label.toLowerCase()) ? 'text-success fw-bold' : 'text-danger'
                "
              >
                {{ fulfilledTags.has(label.toLowerCase()) ? '✓' : '✗' }} {{ label }}
              </span>
            </template>
            <template v-else>{{ label }}</template>
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

          <template #cell(col_toy)="{ value }">
            <span v-if="value" class="text-success">✓</span>
          </template>

          <template #cell(col_relaxation)="{ value }">
            <span v-if="value" class="text-success">✓</span>
          </template>

          <template #cell(col_decoration)="{ value }">
            <span v-if="value" class="text-success">✓</span>
          </template>
        </BTable>
      </details>
    </details>
  </BListGroupItem>
</template>
