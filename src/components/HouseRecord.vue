<script setup lang="ts">
import HabitatModal from '@/components/HabitatModal.vue'
import HouseMateModal from '@/components/HouseMateModal.vue'
import HouseOccupancy from '@/components/HouseOccupancy.vue'
import HouseRecommendations from '@/components/HouseRecommendations.vue'
import { houseFavoriteColumns, sameFavorites } from '@/houseRecommendations'
import { topHouseMates, type HouseMateMatch, type SpawnHabitat } from '@/queries'
import { type AdjacencyData, type HouseAssignment, type PokemonData } from '@/solver'
import { useCartStore } from '@/stores/cart'
import { usePinStore } from '@/stores/pins'
import { BListGroupItem } from 'bootstrap-vue-next'
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    house: HouseAssignment
    pokemonData: PokemonData
    spawnHabitatsByName?: Record<string, SpawnHabitat[]>
    // Full pokemon catalog names, for the empty-house inline search and the
    // housemate modal's fallback search.
    allPokemonNames?: string[]
    // All pokemon currently on the island (Set built once by HomeView): the
    // exclusion set for suggestions so an island resident is never re-proposed.
    islandPokemon?: ReadonlySet<string>
    // Null/undefined until the adjacency payload lands; suggestion buttons
    // stay disabled until then because conflict exclusion requires the matrix.
    adjacencyData?: AdjacencyData | null
    // Drag awareness: marks the card root as a house drop zone and forwards the
    // drag affordance to its PokemonCards. Purely presentational — HomeView owns
    // the pointer gesture and the placement override.
    dragEnabled?: boolean
    dropOver?: boolean
    // Whether island-wide auto-sort is on: forwarded to the housemate modal so
    // its re-sort warning can render and undermine itself via update:autoSort.
    autoSort?: boolean
  }>(),
  {
    allPokemonNames: () => [],
    islandPokemon: () => new Set<string>(),
    dragEnabled: false,
    dropOver: false,
    autoSort: true,
  },
)

const isFull = computed(() => props.house.pokemon.length >= props.house.capacity)

// Adding a pokemon is OWNED by HomeView (selection + auto-pin + re-solve);
// HouseRecord only reports the intent.
const emit = defineEmits<{
  'add-pokemon': [payload: { houseId: string; name: string }]
  'update:autoSort': [value: boolean]
}>()

const cartStore = useCartStore()
const pinStore = usePinStore()

// Habitat-detail modal state: one HabitatModal per house card; only one is
// ever open. Thumbnails re-emit `habitatClicked` from PokemonCards.
const openHabitat = ref<SpawnHabitat | null>(null)

function onHabitatClick(habitat: SpawnHabitat) {
  openHabitat.value = habitat
}

function toggleHousePin() {
  pinStore.toggleHousePin(props.house.houseId, props.house.pokemon)
}

const houseCartItems = computed(() => cartStore.itemsByHouse.get(props.house.houseId) ?? [])
const hasItems = computed(() => houseCartItems.value.length > 0)

// Plus-cards render disabled (with a tooltip) until the adjacency payload is
// in — without it suggestions can't exclude hard habitat conflicts.
const suggestionsReady = computed(() => props.adjacencyData != null)

// --- Empty-slot "+" cards / housemate suggestions --------------------------
// One plus-card per vacant bed. Clicking opens this house's HouseMateModal
// and lazily runs topHouseMates (occupant chemistry + stocked-favorite bonus,
// island residents excluded). The run counter guards against rapid
// open/close sequences cross-populating the modal.
const houseMateModalOpen = ref(false)
const houseMateMatches = ref<HouseMateMatch[] | null>(null)
let houseMateRun = 0

async function openHouseMateModal() {
  const adjacency = props.adjacencyData
  if (!adjacency) return
  const run = ++houseMateRun
  houseMateMatches.value = null
  houseMateModalOpen.value = true
  try {
    const matches = await topHouseMates({
      occupants: [...props.house.pokemon],
      cartItemNames: houseCartItems.value.map((item) => item.name),
      excludedNames: props.islandPokemon,
      adjacency,
    })
    if (run !== houseMateRun) return
    houseMateMatches.value = matches
  } catch {
    // A failed lookup must not strand the modal on its spinner: fall back to
    // the empty state (note + search input), matching HabitatModal's failure
    // path convention.
    if (run !== houseMateRun) return
    houseMateMatches.value = []
  }
}

function closeHouseMateModal() {
  houseMateRun++ // ignore any in-flight suggestions
  houseMateModalOpen.value = false
}

function onHouseMateSelect(name: string) {
  emit('add-pokemon', { houseId: props.house.houseId, name })
}

// Shared ref for the ✓ cells on PokemonCards AND the recommendation graying.
// HouseRecommendations reports freshly computed sets; sameFavorites keeps the
// ref identity stable so PokemonCards don't re-render on no-op watch runs.
const fulfilledFavorites = ref<Set<string>>(new Set())

function onFulfilledFavorites(next: Set<string>) {
  if (!sameFavorites(fulfilledFavorites.value, next)) {
    fulfilledFavorites.value = next
  }
}

// Root-card "fully fulfilled" class: all house-favorite columns are fulfilled.
const allFulfilled = computed(() => {
  if (props.house.pokemon.length === 0) return false
  return houseFavoriteColumns(props.house.pokemon, props.pokemonData).every((col) =>
    fulfilledFavorites.value.has(col.favorite),
  )
})

// Forward PokemonCard favorite-badge clicks into the recommendations panel
// (owned by HouseRecommendations): open + sort + scroll + summary focus.
const recommendationsRef = ref<InstanceType<typeof HouseRecommendations> | null>(null)

function onFavoriteClick(favorite: string) {
  recommendationsRef.value?.focusFavorite(favorite)
}
</script>

<template>
  <BListGroupItem
    class="house-card drop-zone"
    data-testid="house-card"
    data-drop-zone="house"
    :data-drop-house="house.houseId"
    :class="[
      {
        'checked-off': pinStore.isHousePinned(house.houseId),
        'fully-fulfilled': allFulfilled,
        'drop-zone--over': dropOver,
        'drop-zone--full': isFull,
      },
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

    <HouseOccupancy
      :house="house"
      :pokemon-data="pokemonData"
      :spawn-habitats-by-name="spawnHabitatsByName"
      :all-pokemon-names="allPokemonNames"
      :island-pokemon="islandPokemon"
      :suggestions-ready="suggestionsReady"
      :fulfilled-favorites="fulfilledFavorites"
      :drag-enabled="dragEnabled"
      :has-items="hasItems"
      @favorite-clicked="onFavoriteClick"
      @habitat-clicked="onHabitatClick"
      @add-pokemon="emit('add-pokemon', $event)"
      @open-mate-modal="openHouseMateModal"
    />

    <HouseRecommendations
      ref="recommendationsRef"
      :house="house"
      :pokemon-data="pokemonData"
      :house-cart-items="houseCartItems"
      :fulfilled-favorites="fulfilledFavorites"
      @update:fulfilled-favorites="onFulfilledFavorites"
    />

    <HabitatModal :habitat="openHabitat" @close="openHabitat = null" />

    <!-- One suggestion modal per house card, mirroring the HabitatModal
         ownership pattern. Occupant-empty houses (items-only tier) also get
         the manual search box. -->
    <HouseMateModal
      :house="houseMateModalOpen ? house : null"
      :matches="houseMateMatches"
      :all-pokemon-names="allPokemonNames"
      :excluded-names="islandPokemon"
      :show-search="house.pokemon.length === 0"
      :auto-sort="autoSort"
      @select="onHouseMateSelect"
      @close="closeHouseMateModal"
      @update:auto-sort="emit('update:autoSort', $event)"
    />
  </BListGroupItem>
</template>
