<script setup lang="ts">
import AutoSortCard from '@/components/AutoSortCard.vue'
import HouseRecord from '@/components/HouseRecord.vue'
import HousesConfigCard from '@/components/HousesConfigCard.vue'
import ManageIslandsModal from '@/components/ManageIslandsModal.vue'
import PokemonConfigCard from '@/components/PokemonConfigCard.vue'
import SaveIslandModal from '@/components/SaveIslandModal.vue'
import SavedIslandsCard from '@/components/SavedIslandsCard.vue'
import UnhousedWarning from '@/components/UnhousedWarning.vue'
import { useCatalog } from '@/composables/useCatalog'
import { useDragGesture } from '@/composables/useDragGesture'
import { useDisplayModel } from '@/composables/useDisplayModel'
import { useSavedQueries } from '@/composables/useSavedQueries'
import { useScenarioSerialization } from '@/composables/useScenarioSerialization'
import { useSolverPipeline } from '@/composables/useSolverPipeline'
import { useUrlStateSync } from '@/composables/useUrlStateSync'
import { shouldAutoStart } from '@/onboarding'
import { loadAdjacencyMap, loadItemGraph, loadPokemonNames } from '@/queries'
import { useCartStore } from '@/stores/cart'
import { useHouseStore } from '@/stores/houses'
import { usePinStore } from '@/stores/pins'
import { usePlacementStore } from '@/stores/placements'
import { useProgressStore } from '@/stores/progress'
import { BAlert, BButton, BCol, BRow, BSpinner } from 'bootstrap-vue-next'
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'

// Lazy-loaded guided tour: `v-if="tourActive"` plus the async import keep
// v-onboarding (and its CSS) code-split until the tour is actually initiated.
const OnboardingTour = defineAsyncComponent(() => import('@/components/OnboardingTour.vue'))
const tourActive = ref(false)

const cartStore = useCartStore()
const houseStore = useHouseStore()
const pinStore = usePinStore()
const placementStore = usePlacementStore()
const progressStore = useProgressStore()

const selectedPokemon = ref<string[]>([])

// "Automatically sort Pokemon" toggle (AutoSortCard). While ON the reactive
// solve watch behaves exactly as before; while OFF the watch gates the worker
// dispatch (structural house clamp/reconcile still run) and the display model
// below switches to a registry-authoritative stale view. Persisted in the URL
// hash and saved islands via SharedState.autoSort (missing key restores true).
const autoSort = ref(true)

// Dragged placements are session-only: any mode/restore boundary clears the
// override map so drags never leak across flips, restores, or resets.
watch(
  () => autoSort.value,
  () => placementStore.clear(),
)

const small = ref(0)
const medium = ref(0)
const large = ref(0)

const totalHouses = computed(() => small.value + medium.value + large.value)

const lockedBySize = computed(() =>
  houseStore.lockedCountBySize(pinStore.effectivelyPinnedHouseIds),
)
const minSmall = computed(() => lockedBySize.value.small)
const minMedium = computed(() => lockedBySize.value.medium)
const minLarge = computed(() => lockedBySize.value.large)

// --- Catalog hydration ------------------------------------------------------
const {
  pokemonNames,
  pokemonData,
  spawnHabitatsByName,
  adjacencyData,
  hydratingPokemonData,
  hydratedPokemonReady,
  hydratePokemonSelection,
} = useCatalog(selectedPokemon)

// --- Catalog-ready / loading gates -----------------------------------------
const catalogReady = ref(false)
const showCatalogLoading = computed(() => !catalogReady.value || restoringQuery.value)
const error = ref('')

// --- Shared restore/encode glue (URL hash + saved queries) --------------------
// FIRST: an off-state restore must be in place before the pokemon hydration
// below completes — the solve watch is not suppressed during restore (unlike
// the hash watch) and would otherwise dispatch an initial solve.
const { restoreState, encodeState } = useScenarioSerialization({
  small,
  medium,
  large,
  selectedPokemon,
  autoSort,
  hydratePokemonSelection,
})

// --- Saved queries (localStorage) -------------------------------------------
// Register order matters: this (selectedTimestamp watch) must precede the
// selectedPokemon hydration watch below, mirroring the pre-refactor setup.
const {
  savedQueries,
  selectedTimestamp,
  queryTitle,
  showSaveModal,
  showManageModal,
  saveSuccess,
  restoringQuery,
  deletedUndoTitle,
  openSaveModal,
  confirmSave,
  deleteSaved,
  undoDelete,
  onSaveEnter,
} = useSavedQueries({ restoreState, small, medium, large, selectedPokemon, autoSort })

watch(
  selectedPokemon,
  async (names) => {
    await hydratePokemonSelection(names)
  },
  { deep: true },
)

// --- URL hash sharing --------------------------------------------------------
const { restoreFromHash } = useUrlStateSync({
  encodeState,
  restoreState,
  sources: [
    small,
    medium,
    large,
    selectedPokemon,
    autoSort,
    () => cartStore.serializedCart,
    () => progressStore.checkedCartItems,
    () => progressStore.placedItems,
    () => pinStore.pinnedHouses,
    () => pinStore.pinnedPokemon,
  ],
})

// --- Solver pipeline ----------------------------------------------------------
const { result, solving } = useSolverPipeline({
  selectedPokemon,
  small,
  medium,
  large,
  autoSort,
  hydratedPokemonReady,
  adjacencyData,
  pokemonData,
  minSmall,
  minMedium,
  minLarge,
  totalHouses,
  error,
})

const loading = computed(() => hydratingPokemonData.value || solving.value)

// --- Display model (mode-gated) ----------------------------------------------
const { displayedHouses, sortedHouses, showResults, displayedUnhoused, islandPokemonSet } =
  useDisplayModel({ result, selectedPokemon, pokemonData, autoSort })

// --- Guided tour (v-onboarding) ----------------------------------------------
// Ready once the sample island's first solve has produced houses to point at;
// the tour component self-starts the moment this flips true.
const tourReady = computed(() => !solving.value && displayedHouses.value.length > 0)

function startTour() {
  tourActive.value = true
  loadSample()
}

// --- Handlers -----------------------------------------------------------------
// Empty-slot flow (HouseRecord "+" cards / empty-house input): add the
// pokemon to the island AND pin it to the requesting house BEFORE the next
// debounced solve, so the pin-complement fill keeps the newcomer in place.
function addPokemonToHouse({ houseId, name }: { houseId: string; name: string }) {
  // The selection UIs exclude island residents, but guard anyway: a duplicate
  // would double-count the pokemon in the island set.
  if (selectedPokemon.value.includes(name)) return
  pinStore.pinPokemon(houseId, name)
  selectedPokemon.value = [...selectedPokemon.value, name]
}

function loadSample() {
  pinStore.clear()
  placementStore.clear()
  progressStore.restoreProgress({})
  houseStore.clear()
  small.value = 1
  medium.value = 3
  large.value = 2
  houseStore.reconcileHouses({ small: 1, medium: 3, large: 2 }, new Set())
  const shuffled = [...pokemonNames.value].sort(() => Math.random() - 0.5)
  selectedPokemon.value = shuffled.slice(0, 13)
}

function clearHouses() {
  small.value = 0
  medium.value = 0
  large.value = 0
  placementStore.clear()
}

function clearPokemon() {
  selectedPokemon.value = []
  pokemonData.value = {}
  spawnHabitatsByName.value = {}
  placementStore.clear()
}

// --- Drag & drop (pointer events) --------------------------------------------
const {
  dragOverTarget,
  draggingName,
  dragPos,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
} = useDragGesture({
  isEnabled: () => !autoSort.value,
  getHouse: (houseId) => displayedHouses.value.find((h) => h.houseId === houseId),
  setPlacement: (name, target) => placementStore.set(name, target),
})

onMounted(async () => {
  try {
    // Fire-and-forget: preload the item graph so the first cart interaction is
    // pure in-memory (the cached promise means every item helper shares this load).
    void loadItemGraph()
    const [names, adjacency] = await Promise.all([loadPokemonNames(), loadAdjacencyMap()])
    pokemonNames.value = names
    adjacencyData.value = adjacency

    await restoreFromHash()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    catalogReady.value = true
    // First visit (no seen flag) and NOT arriving via a shared URL hash →
    // auto-start the guided tour by pre-loading the sample island.
    if (shouldAutoStart(window.location.hash.length > 0)) startTour()
  }
})

defineExpose({
  small,
  medium,
  large,
  selectedPokemon,
  autoSort,
  solving,
  spawnHabitatsByName,
  queryTitle,
  confirmSave,
  selectedTimestamp,
  savedQueries,
  showSaveModal,
  showManageModal,
  deleteSaved,
  undoDelete,
  onSaveEnter,
  addPokemonToHouse,
})
</script>

<template>
  <div
    v-if="showCatalogLoading"
    data-testid="catalog-loading"
    class="d-flex flex-column align-items-center justify-content-center gap-3 catalog-loading"
    role="status"
    aria-live="polite"
  >
    <BSpinner />
    <p>{{ restoringQuery ? 'Restoring saved island…' : 'Loading catalog…' }}</p>
  </div>

  <div v-if="!showCatalogLoading" class="home-theme content-stack">
    <OnboardingTour v-if="tourActive" :is-ready="tourReady" @exited="tourActive = false" />

    <BAlert
      variant="info"
      data-testid="sample-island-alert"
      class="d-flex flex-wrap align-items-center justify-content-center gap-2 mb-0 sample-island-alert"
      :model-value="true"
    >
      <span class="me-2">Not sure where to start?</span>
      <BButton variant="outline-secondary" class="beach-button" @click="loadSample">
        Show a sample island
      </BButton>
      <BButton variant="info" class="beach-button" data-testid="take-the-tour" @click="startTour">
        Take the tour
      </BButton>
    </BAlert>
    <BRow class="g-2 g-md-3">
      <BCol cols="12" xl="2">
        <AutoSortCard v-model="autoSort" />
      </BCol>
      <BCol cols="12" xl="3">
        <HousesConfigCard
          :small="small"
          :medium="medium"
          :large="large"
          :min-small="minSmall"
          :min-medium="minMedium"
          :min-large="minLarge"
          @update:small="small = $event"
          @update:medium="medium = $event"
          @update:large="large = $event"
          @clear-all="clearHouses"
        />
      </BCol>
      <BCol cols="12" xl="3">
        <PokemonConfigCard
          :selected-pokemon="selectedPokemon"
          :pokemon-names="pokemonNames"
          :pinned-names="pinStore.allPinnedPokemonNames"
          @update:selected-pokemon="selectedPokemon = $event"
          @clear-all="clearPokemon"
        />
      </BCol>
      <BCol cols="12" xl="4">
        <SavedIslandsCard
          :saved-queries="savedQueries"
          :selected-timestamp="selectedTimestamp"
          :save-success="saveSuccess"
          :deleted-undo-title="deletedUndoTitle"
          :can-save="pokemonNames.length > 0"
          @update:selected-timestamp="selectedTimestamp = $event"
          @save="openSaveModal"
          @manage="showManageModal = true"
          @undo="undoDelete"
        />
      </BCol>
    </BRow>

    <SaveIslandModal
      v-model="showSaveModal"
      v-model:title="queryTitle"
      @ok="confirmSave"
      @enter="onSaveEnter"
    />

    <ManageIslandsModal
      v-model="showManageModal"
      :saved-queries="savedQueries"
      @delete="deleteSaved"
    />

    <BSpinner v-if="loading" class="my-3" />
  </div>

  <BAlert
    v-if="error"
    variant="danger"
    :model-value="true"
    data-testid="error"
    class="mt-2 status-alert"
  >
    {{ error }}
  </BAlert>

  <section
    v-if="showResults && !showCatalogLoading"
    data-testid="results"
    class="results-section"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
  >
    <h2 class="section-heading">Results</h2>

    <div
      v-if="draggingName"
      class="pokemon-drag-ghost"
      :style="{
        left: (dragPos?.x ?? 0) + 'px',
        top: (dragPos?.y ?? 0) + 'px',
      }"
    >
      {{ draggingName }}
    </div>

    <UnhousedWarning
      :auto-sort="autoSort"
      :displayed-unhoused="displayedUnhoused"
      :pokemon-data="pokemonData"
      :drag-over-target="dragOverTarget"
    />

    <TransitionGroup
      tag="div"
      class="list-group list-group-flush w-100 results-list"
      :class="{ 'results-pending': solving }"
      move-class="house-move"
    >
      <HouseRecord
        v-for="house in sortedHouses"
        :key="house.houseId"
        :house="house"
        :pokemon-data="pokemonData!"
        :spawn-habitats-by-name="spawnHabitatsByName"
        :all-pokemon-names="pokemonNames"
        :island-pokemon="islandPokemonSet"
        :adjacency-data="adjacencyData"
        :drag-enabled="!autoSort"
        :drop-over="
          dragOverTarget != null &&
          dragOverTarget.type === 'house' &&
          dragOverTarget.houseId === house.houseId
        "
        :auto-sort="autoSort"
        @add-pokemon="addPokemonToHouse"
        @update:auto-sort="autoSort = $event"
      />
    </TransitionGroup>
  </section>
</template>
