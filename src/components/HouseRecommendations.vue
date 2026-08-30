<script setup lang="ts">
import { assetPath } from '@/assetPath'
import IconGlyph from '@/components/IconGlyph.vue'
import { iconForFavorite } from '@/favoriteIcons'
import {
  buildRecommendationRows,
  compareRows,
  favoriteCellTitle,
  houseFavoriteColumns as buildHouseFavoriteColumns,
  type RecommendationRow,
} from '@/houseRecommendations'
import {
  favoriteCoverageColumnKey,
  favoritesForItems,
  RECOMMENDED_ITEM_TAGS,
  recommendedItemsForHouseAllNeeds,
  type ItemDetails,
} from '@/queries'
import { type HouseAssignment, type PokemonData } from '@/solver'
import { useCartStore } from '@/stores/cart'
import { useProgressStore } from '@/stores/progress'
import type { BTableSortBy } from 'bootstrap-vue-next'
import { BBadge, BButton, BCloseButton, BFormCheckbox, BTable } from 'bootstrap-vue-next'
import { computed, ref, watch, watchEffect } from 'vue'

const props = defineProps<{
  house: HouseAssignment
  pokemonData: PokemonData
  houseCartItems: ItemDetails[]
  fulfilledFavorites: Set<string>
}>()

// `fulfilledFavorites` stays OWNED by HouseRecord (it also feeds PokemonCard's
// ✓ cells); this child reports the freshly computed set and HouseRecord applies
// the `sameFavorites` identity guard.
const emit = defineEmits<{
  'update:fulfilledFavorites': [value: Set<string>]
}>()

const cartStore = useCartStore()
const progressStore = useProgressStore()

const fulfilledTags = computed(
  () => new Set(props.houseCartItems.map((item) => item.tag).filter((t): t is string => !!t)),
)

// Lazy render latch: the recommendations BTable only mounts after the panel is
// first opened (recommendation data is still computed eagerly so the summary's
// visibility is unaffected). Once latched, the table stays mounted so repeat
// toggles are free.
const hasOpenedRecs = ref(false)

function onRecsToggle(event: Event) {
  if ((event.target as HTMLDetailsElement).open) {
    hasOpenedRecs.value = true
  }
}

const RECOMMENDATIONS_PAGE_SIZE = 50

const houseFavoriteColumns = computed(() =>
  buildHouseFavoriteColumns(props.house.pokemon, props.pokemonData),
)

const unfulfilledFavoriteColumns = computed(() => {
  const fulfilled = props.fulfilledFavorites
  return houseFavoriteColumns.value.filter((col) => !fulfilled.has(col.favorite))
})

const recommendationTableFields = computed(() => [
  // The action rail (add-to-cart / remove) and the Placed checkbox sit on the
  // left, where they stay reachable now that the favorite/tag columns make the
  // table very wide; the two controls still never share a cell or tap area.
  { key: 'col_actions', label: '', sortable: false },
  { key: 'col_placed', label: 'Placed', sortable: false },
  { key: 'name', label: 'Item', sortable: true },
  { key: 'col_image', label: '', sortable: false },
  { key: 'craftability', label: 'Craftability', sortable: true },
  // Tag columns are always shown (like the favorite columns below), so the
  // user can see when a tag has been fulfilled (rendered with the green header
  // style) rather than having the column disappear.
  { key: 'col_toy', label: 'Toy', sortable: true, class: 'bool-col' },
  { key: 'col_relaxation', label: 'Relaxation', sortable: true, class: 'bool-col' },
  { key: 'col_decoration', label: 'Decoration', sortable: true, class: 'bool-col' },
  // All house-favorite columns are always shown now (the merged table is the
  // only place coverage is shown, and added rows can cover fulfilled favorites).
  // Fulfilled favorites render with the green header style, never removed.
  ...houseFavoriteColumns.value.map((col) => ({
    key: favoriteCoverageColumnKey(col.favorite),
    label: col.favorite,
    sortable: true,
    class: 'bool-col',
    count: col.count,
  })),
])

const activeTableItems = ref<RecommendationRow[]>([])
const visibleCount = ref(RECOMMENDATIONS_PAGE_SIZE)

let recommendationRun = 0

watch(
  [() => props.house.pokemon, () => props.houseCartItems],
  async ([pokemon, items]) => {
    const run = ++recommendationRun

    const cartNames = items.map((item) => item.name)
    const allFavorites = pokemon.flatMap((name) => props.pokemonData[name]?.favorites ?? [])

    // One graph pass over cart items yields the union of fulfilled favorites.
    const cartFavs = await favoritesForItems(cartNames)
    if (run !== recommendationRun) return

    const fulfilledFavoriteSet = new Set(Array.from(cartFavs.values()).flat())
    emit('update:fulfilledFavorites', fulfilledFavoriteSet)

    const unfulfilledFavorites = allFavorites.filter(
      (favorite) => !fulfilledFavoriteSet.has(favorite),
    )

    const unfulfilledTags = RECOMMENDED_ITEM_TAGS.filter((t) => !fulfilledTags.value.has(t))

    const recommendations =
      unfulfilledFavorites.length || unfulfilledTags.length
        ? await recommendedItemsForHouseAllNeeds(
            allFavorites,
            unfulfilledFavorites,
            unfulfilledTags,
          )
        : []
    if (run !== recommendationRun) return

    const allCandidateNames = [...new Set([...recommendations.map((r) => r.name), ...cartNames])]
    const favByItem = await favoritesForItems(allCandidateNames)
    if (run !== recommendationRun) return

    activeTableItems.value = buildRecommendationRows({
      recommendations,
      cartItems: items,
      favByItem,
      fulfilledFavoriteSet,
      favoriteColumns: houseFavoriteColumns.value,
      fulfilledTags: fulfilledTags.value,
    })
  },
  { deep: true, immediate: true },
)

const sortBy = ref<BTableSortBy[]>([])
const showCraftableOnly = ref(false)

// Auto-sort tracking. While `sortIsAuto` is true the recommendation table's
// sort is owned by the auto-ranker (aimed at the first unfulfilled favorite),
// so it re-ranks symmetrically — re-ranking to the next unfulfilled favorite
// when the active one is fulfilled by an added item, and restoring the
// original favorite when that item is removed. A user-driven sort (clicking a
// column header or a favorite badge) hands control to the user, who we never
// override. `writingAuto` guards the detection watcher below so the
// auto-ranker's own writes aren't mistaken for user input.
let writingAuto = false
const sortIsAuto = ref(true)

// Any sortBy change not produced by the auto-ranker is user input (BTable
// header click via v-model, or onFavoriteClick). Take the table out of auto
// mode so the auto-ranker stops overriding the user's choice.
watch(
  sortBy,
  () => {
    if (!writingAuto) sortIsAuto.value = false
  },
  { deep: true, flush: 'sync' },
)

const recsDetails = ref<HTMLDetailsElement | null>(null)

// Favorite-badge clicks (re-emitted by PokemonCard) route the user to the
// items that fulfill that favorite: open the recommendations panel, latch the
// lazy table mount, sort the matching coverage column to the top, and scroll
// the panel into view. All favorite columns are always present, so a
// fulfilled-favorite click still resolves to a column and opens the panel.
function focusFavorite(favorite: string) {
  const details = recsDetails.value
  if (!details) return

  const key = favoriteCoverageColumnKey(favorite)
  if (recommendationTableFields.value.some((f) => f.key === key)) {
    sortBy.value = [{ key, order: 'desc' }]
  }

  details.open = true
  // Setting .open programmatically does not reliably fire the toggle event in
  // all environments, so latch the lazy table mount explicitly (mirrors
  // onRecsToggle).
  hasOpenedRecs.value = true

  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (typeof details.scrollIntoView === 'function') {
    details.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' })
  }

  // Land keyboard/screen-reader users in context; mouse users are unaffected.
  details.querySelector('summary')?.focus()
}

defineExpose({ focusFavorite })

// Added rows are exempt from the craftable-only filter so an in-cart
// non-craftable item never leaves the (now sole) table — the old coverage
// table never filtered cart items by craftability either.
const filteredRows = computed(() =>
  activeTableItems.value.filter(
    (row) => row.added || !showCraftableOnly.value || row.itemData.isCraftable,
  ),
)

// BTable row class: give in-cart (added) rows a subtle background so they stand
// out beyond the "Added" badge alone. Applied via `tbody-tr-class` to each row.
function addedRowClass(item: unknown): string {
  return (item as RecommendationRow | null)?.added ? 'recommendation-added-row' : ''
}

const sortedRows = computed(() =>
  [...filteredRows.value].sort((a, b) => compareRows(a, b, sortBy.value)),
)

const visibleRows = computed(() => sortedRows.value.slice(0, visibleCount.value))

const hasMore = computed(() => visibleCount.value < sortedRows.value.length)

const remainingCount = computed(() => sortedRows.value.length - visibleCount.value)

// Reset the expanded window on a new pokemon set and on the craftable-only
// toggle. Cart add/remove reorders the same list, so user expansion persists.
watch(
  () => props.house.pokemon,
  () => {
    visibleCount.value = RECOMMENDATIONS_PAGE_SIZE
  },
  { deep: true },
)

watch(showCraftableOnly, () => {
  visibleCount.value = RECOMMENDATIONS_PAGE_SIZE
})

watchEffect(() => {
  const cols = unfulfilledFavoriteColumns.value
  const firstKey = cols.length > 0 ? favoriteCoverageColumnKey(cols[0]!.favorite) : undefined
  const validKeys = new Set(
    recommendationTableFields.value.filter((f) => f.sortable).map((f) => f.key),
  )

  const active = sortBy.value[0]
  const activeKey = active?.key
  const activeValid = activeKey != null && validKeys.has(activeKey)

  // If the user owns the sort, leave their choice alone — only fall back to
  // the auto sort when their target column has disappeared entirely.
  if (!sortIsAuto.value) {
    if (active && !activeValid) {
      writingAuto = true
      sortBy.value = firstKey ? [{ key: firstKey, order: 'desc' }] : []
      writingAuto = false
      sortIsAuto.value = true
    }
    return
  }

  // Auto-owner: aim the sort at the highest-priority unfulfilled favorite.
  // This is symmetric — it re-ranks to the next unfulfilled favorite when the
  // active one is fulfilled by an added item, and it restores the original
  // favorite when that item is removed and it becomes unfulfilled again.
  if (firstKey && activeKey !== firstKey) {
    writingAuto = true
    sortBy.value = [{ key: firstKey, order: 'desc' }]
    writingAuto = false
  }
})
</script>

<template>
  <details
    v-if="activeTableItems.length"
    ref="recsDetails"
    data-testid="recommended-items"
    class="mt-2 house-recommendations"
    @toggle="onRecsToggle"
  >
    <summary>House items</summary>
    <div v-if="hasOpenedRecs" class="craftable-only-toggle" data-testid="craftable-only-toggle">
      <BFormCheckbox
        v-model="showCraftableOnly"
        switch
        size="sm"
        class="d-inline-block align-middle"
        >Craftable only</BFormCheckbox
      >
    </div>
    <BTable
      v-if="hasOpenedRecs"
      primary-key="name"
      no-local-sorting
      no-border-collapse
      small
      responsive
      class="recommended-items-table"
      :fields="recommendationTableFields"
      :items="visibleRows"
      v-model:sort-by="sortBy"
      :tbody-tr-class="addedRowClass"
      data-testid="recommended-items-list"
    >
      <template #head()="{ column, label, field }">
        <template v-if="(column as string).startsWith('fav_')">
          <span
            :class="
              fulfilledFavorites.has(label as string) ? 'text-success fw-bold' : 'text-danger'
            "
            :data-testid="`fav-header-${column}`"
          >
            <IconGlyph :name="iconForFavorite(label as string)" />
            {{ label }} &times;{{ (field as any).count }}
          </span>
        </template>
        <template
          v-else-if="
            column === 'col_toy' || column === 'col_relaxation' || column === 'col_decoration'
          "
        >
          <span
            :class="fulfilledTags.has(label as string) ? 'text-success fw-bold' : 'text-danger'"
            :data-testid="`tag-header-${column}`"
          >
            {{ label }}
          </span>
        </template>
        <template v-else-if="column === 'col_image'"
          ><span class="visually-hidden">Item image</span></template
        >
        <template v-else-if="column === 'col_actions'"
          ><span class="visually-hidden">Actions</span></template
        >
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

      <template #cell(col_placed)="{ item }">
        <label
          v-if="(item as any).added"
          class="progress-action progress-action--placed progress-action--compact"
          title="Mark as placed in this house — also syncs with sidebar cart"
        >
          <input
            type="checkbox"
            :checked="progressStore.isItemPlaced(house.houseId, (item as any).name)"
            data-testid="recommendation-placed"
            @change="progressStore.togglePlacedItem(house.houseId, (item as any).name)"
          />
          <span>Placed</span>
        </label>
      </template>

      <template #cell(col_actions)="{ item }">
        <BCloseButton
          v-if="(item as any).added"
          class="item-remove"
          data-testid="recommendation-remove"
          :aria-label="`Remove ${(item as any).name} from house ${house.houseId} cart`"
          :title="`Remove ${(item as any).name} from house ${house.houseId} cart`"
          @click="cartStore.removeItem(house.houseId, (item as any).name)"
        />
        <BButton
          v-else
          size="sm"
          variant="outline-success"
          class="cart-add-btn"
          data-testid="add-to-cart"
          :aria-label="`Add ${(item as any).name} to cart for house ${house.houseId}`"
          :title="`Add ${(item as any).name} to cart for house ${house.houseId}`"
          @click="cartStore.addItem(house.houseId, (item as any).name)"
          >+</BButton
        >
      </template>

      <template #cell(name)="{ item }">
        <span
          :title="(item as any).itemData.flavorText ?? undefined"
          :class="{
            'text-decoration-line-through': progressStore.isItemPlaced(
              house.houseId,
              (item as any).name,
            ),
          }"
          data-testid="item-name"
        >
          {{ (item as any).name }}
          <BBadge
            v-if="(item as any).added"
            pill
            variant="success"
            class="ms-1"
            data-testid="recommendation-added-badge"
            >Added</BBadge
          >
        </span>
      </template>

      <template #cell(craftability)="{ item }">
        <span data-testid="item-craftability">{{ (item as any).craftability }}</span>
      </template>

      <template #cell()="{ field, value, item }">
        <span
          v-if="(field as any).class === 'bool-col' && value"
          class="bool-check"
          :title="favoriteCellTitle(item as any, (field as any).key, fulfilledFavorites)"
          >✓</span
        >
      </template>

      <template #custom-foot="{ fields }">
        <tr v-if="hasMore" class="recommendations-more-row">
          <td :colspan="fields.length">
            <BButton
              size="sm"
              variant="link"
              class="recommendations-more-btn"
              data-testid="recommendations-more"
              :aria-label="`Show ${Math.min(RECOMMENDATIONS_PAGE_SIZE, remainingCount)} more recommended items`"
              @click="visibleCount += RECOMMENDATIONS_PAGE_SIZE"
              >Show 50 more</BButton
            >
          </td>
        </tr>
      </template>
    </BTable>
  </details>
</template>
