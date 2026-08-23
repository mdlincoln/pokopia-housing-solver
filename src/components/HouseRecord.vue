<script lang="ts">
// Set equality by contents: same size and every element present. Used to keep
// the fulfilledFavorites ref identity stable when a watch re-run computes an
// unchanged set, avoiding no-op PokemonCard re-renders.
export function sameFavorites(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const favorite of a) {
    if (!b.has(favorite)) return false
  }
  return true
}
</script>

<script setup lang="ts">
import { assetPath } from '@/assetPath'
import IconGlyph from '@/components/IconGlyph.vue'
import PokemonCard from '@/components/PokemonCard.vue'
import { iconForFavorite } from '@/favoriteIcons'
import {
  favoriteCoverageColumnKey,
  favoritesForItems,
  RECOMMENDED_ITEM_TAGS,
  recommendedItemsForHouseAllNeeds,
  type ItemDetails,
} from '@/queries'
import { type HouseAssignment, type PokemonData } from '@/solver'
import { useCartStore } from '@/stores/cart'
import { usePinStore } from '@/stores/pins'
import { useProgressStore } from '@/stores/progress'
import type { BTableSortBy } from 'bootstrap-vue-next'
import {
  BBadge,
  BButton,
  BCloseButton,
  BFormCheckbox,
  BListGroupItem,
  BTable,
} from 'bootstrap-vue-next'
import { computed, ref, watch, watchEffect } from 'vue'

const props = defineProps<{
  house: HouseAssignment
  pokemonData: PokemonData
}>()

const cartStore = useCartStore()
const pinStore = usePinStore()
const progressStore = useProgressStore()

function toggleHousePin() {
  pinStore.toggleHousePin(props.house.houseId, props.house.pokemon)
}

const houseCartItems = computed(() => cartStore.itemsByHouse.get(props.house.houseId) ?? [])

const fulfilledTags = computed(
  () => new Set(houseCartItems.value.map((item) => item.tag).filter((t): t is string => !!t)),
)

const fulfilledFavorites = ref<Set<string>>(new Set())

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

interface RecommendationRow extends Record<string, unknown> {
  itemData: ItemDetails
  name: string
  craftability: string
  added: boolean
  recOrder: number
  col_toy: boolean
  col_relaxation: boolean
  col_decoration: boolean
  _cellVariants?: Record<string, 'success' | 'secondary'>
}

const houseFavoriteColumns = computed(() => {
  const freq = new Map<string, number>()
  for (const name of props.house.pokemon) {
    for (const fav of props.pokemonData[name]?.favorites ?? []) {
      freq.set(fav, (freq.get(fav) ?? 0) + 1)
    }
  }
  return Array.from(freq.entries())
    .map(([favorite, count]) => ({ favorite, count }))
    .sort((a, b) => b.count - a.count || a.favorite.localeCompare(b.favorite))
})

const unfulfilledFavoriteColumns = computed(() => {
  const fulfilled = fulfilledFavorites.value
  return houseFavoriteColumns.value.filter((col) => !fulfilled.has(col.favorite))
})

const allFulfilled = computed(
  () => props.house.pokemon.length > 0 && unfulfilledFavoriteColumns.value.length === 0,
)

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

function craftabilityText(item: ItemDetails): string {
  return item.isCraftable ? (item.category ? `Craftable (${item.category})` : 'Craftable') : 'Buy'
}

const activeTableItems = ref<RecommendationRow[]>([])
const visibleCount = ref(RECOMMENDATIONS_PAGE_SIZE)

function buildRecommendationRow(
  itemData: ItemDetails,
  added: boolean,
  recOrder: number,
  itemFavs: string[],
  fulfilledSet: Set<string>,
): RecommendationRow {
  const row: RecommendationRow = {
    itemData,
    name: itemData.name,
    craftability: craftabilityText(itemData),
    added,
    recOrder,
    col_toy: itemData.tag === 'Toy',
    col_relaxation: itemData.tag === 'Relaxation',
    col_decoration: itemData.tag === 'Decoration',
  }
  const cellVariants: Record<string, 'success' | 'secondary'> = {}
  // Tag coverage: a non-placed (unadded) row whose tag is already fulfilled is
  // redundant — gray out that tag cell (like redundant favorite coverage) to
  // signal it is lower value, while added rows keep the success highlight.
  if (row.col_toy) {
    cellVariants['col_toy'] = !added && fulfilledTags.value.has('Toy') ? 'secondary' : 'success'
  }
  if (row.col_relaxation) {
    cellVariants['col_relaxation'] =
      !added && fulfilledTags.value.has('Relaxation') ? 'secondary' : 'success'
  }
  if (row.col_decoration) {
    cellVariants['col_decoration'] =
      !added && fulfilledTags.value.has('Decoration') ? 'secondary' : 'success'
  }
  const favSet = new Set(itemFavs)
  for (const col of houseFavoriteColumns.value) {
    const cellKey = favoriteCoverageColumnKey(col.favorite)
    const isCovered = favSet.has(col.favorite)
    row[cellKey] = isCovered
    if (isCovered) {
      // A non-placed (unadded) row covering an already-fulfilled favorite is
      // redundant — gray out that coverage cell instead of the success highlight
      // to signal it is lower value than coverage of still-unfulfilled needs.
      if (!added && fulfilledSet.has(col.favorite)) {
        cellVariants[cellKey] = 'secondary'
      } else {
        cellVariants[cellKey] = 'success'
      }
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

    const cartNames = items.map((item) => item.name)
    const allFavorites = pokemon.flatMap((name) => props.pokemonData[name]?.favorites ?? [])

    // One graph pass over cart items yields the union of fulfilled favorites.
    const cartFavs = await favoritesForItems(cartNames)
    if (run !== recommendationRun) return

    const fulfilledFavoriteSet = new Set(Array.from(cartFavs.values()).flat())
    // Only swap the Set identity when contents actually changed so PokemonCards
    // don't re-render on every no-op watch run.
    if (!sameFavorites(fulfilledFavorites.value, fulfilledFavoriteSet)) {
      fulfilledFavorites.value = fulfilledFavoriteSet
    }

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

    const cartNameSet = new Set(cartNames)
    const baseNames = new Set(recommendations.map((r) => r.name))

    const baseRows = recommendations.map((rec, index) =>
      buildRecommendationRow(
        rec,
        cartNameSet.has(rec.name),
        index,
        favByItem.get(rec.name) ?? [],
        fulfilledFavoriteSet,
      ),
    )

    // Cart items not already present as a base row become added-only rows so
    // every cart item appears exactly once (base row wins on name dedupe).
    let order = recommendations.length
    const addedOnlyRows: RecommendationRow[] = []
    for (const item of items) {
      if (baseNames.has(item.name)) continue
      addedOnlyRows.push(
        buildRecommendationRow(
          item,
          true,
          order++,
          favByItem.get(item.name) ?? [],
          fulfilledFavoriteSet,
        ),
      )
    }

    activeTableItems.value = [...baseRows, ...addedOnlyRows]
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
function onFavoriteClick(favorite: string) {
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

// Added rows are exempt from the craftable-only filter so an in-cart
// non-craftable item never leaves the (now sole) table — the old coverage
// table never filtered cart items by craftability either.
const filteredRows = computed(() =>
  activeTableItems.value.filter(
    (row) => row.added || !showCraftableOnly.value || row.itemData.isCraftable,
  ),
)

// Mirrors BTable's default comparator (string coercion + numeric-aware
// localeCompare, inverted on desc), with `added` as the leading key so
// added rows always sort above unadded ones and `recOrder` as the final
// tie-break preserving recommendation relevance.
function compareRows(a: RecommendationRow, b: RecommendationRow): number {
  if (a.added !== b.added) return a.added ? -1 : 1
  for (const { key, order } of sortBy.value) {
    const c = String(a[key] ?? '').localeCompare(String(b[key] ?? ''), undefined, {
      numeric: true,
    })
    if (c !== 0) return order === 'desc' ? -c : c
  }
  return a.recOrder - b.recOrder
}

// Hover tooltip for a favorite-coverage ✓ cell. "Placed" here means the item is
// in this house's cart (committed to this house): an in-cart item is actively
// fulfilling the need, an unadded item could fulfill it, and an unadded item
// covering an already-fulfilled need is redundant (grayed) — the same states
// the cell backgrounds communicate.
function favoriteCellTitle(item: RecommendationRow, fieldKey: string): string | undefined {
  if (!fieldKey.startsWith('fav_')) return undefined
  const favorite = fieldKey.slice('fav_'.length)
  if (item.added) {
    return `${item.name} is fulfilling ${favorite}`
  }
  if (fulfilledFavorites.value.has(favorite)) {
    return `${item.name} would fulfill ${favorite}, but it is fulfilled by other items already placed in this house.`
  }
  return `${item.name} could fulfill ${favorite} if it were placed in this house`
}

// BTable row class: give in-cart (added) rows a subtle background so they stand
// out beyond the "Added" badge alone. Applied via `tbody-tr-class` to each row.
function addedRowClass(item: unknown): string {
  return (item as RecommendationRow | null)?.added ? 'recommendation-added-row' : ''
}

const sortedRows = computed(() => [...filteredRows.value].sort(compareRows))

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
  <BListGroupItem
    class="house-card"
    data-testid="house-card"
    :class="[
      { 'checked-off': pinStore.isHousePinned(house.houseId), 'fully-fulfilled': allFulfilled },
    ]"
  >
    <h3 class="mb-1 house-title">
      <button
        type="button"
        role="checkbox"
        :aria-checked="pinStore.isHousePinned(house.houseId)"
        :aria-label="
          pinStore.isHousePinned(house.houseId)
            ? `Unpin house ${house.houseId}`
            : `Pin this house (${house.houseId}) so it stays put when re-solving`
        "
        class="btn btn-link p-0 me-2 pin-icon"
        data-testid="progress-checkbox-house"
        @click="toggleHousePin"
        title="Pin this house and all its pokemon so they stay when re-solving"
      >
        <i :class="pinStore.isHousePinned(house.houseId) ? 'bi bi-lock-fill' : 'bi bi-unlock'"></i>
      </button>
      {{ house.size }} house {{ house.houseId }}
    </h3>

    <div v-if="house.pokemon.length > 0" class="pokemon-grid">
      <PokemonCard
        v-for="name in house.pokemon"
        :key="name"
        :name="name"
        :image="pokemonData[name]?.image ?? ''"
        :favorites="pokemonData[name]?.favorites ?? []"
        :habitat="pokemonData[name]?.habitat"
        :checked="pinStore.isPokemonPinned(house.houseId, name)"
        :fulfilled-favorites="fulfilledFavorites"
        @toggle="pinStore.togglePokemonPin(house.houseId, name)"
        @favorite-clicked="onFavoriteClick"
      />
    </div>
    <p v-else data-testid="empty" class="text-muted fst-italic mb-0">Empty</p>

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
            :title="favoriteCellTitle(item as any, (field as any).key)"
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
  </BListGroupItem>
</template>
