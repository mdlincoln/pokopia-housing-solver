<script setup lang="ts">
import EmptySlotButton from '@/components/EmptySlotButton.vue'
import PokemonCard from '@/components/PokemonCard.vue'
import PokemonSelect from '@/components/PokemonSelect.vue'
import type { SpawnHabitat } from '@/queries'
import type { HouseAssignment, PokemonData } from '@/solver'
import { usePinStore } from '@/stores/pins'
import { computed } from 'vue'

// The three-way occupancy branch of HouseRecord: PokemonCard roster + empty-slot
// plus-cards, plus-cards only (items but no pokemon), or the empty-house inline
// search. Pinning is handled locally via the pin store (mirroring the original
// HouseRecord template bindings), so this child stays a presentational slice.
const props = withDefaults(
  defineProps<{
    house: HouseAssignment
    pokemonData: PokemonData
    spawnHabitatsByName?: Record<string, SpawnHabitat[]>
    allPokemonNames?: string[]
    islandPokemon?: ReadonlySet<string>
    suggestionsReady: boolean
    fulfilledFavorites: Set<string>
    dragEnabled?: boolean
    hasItems?: boolean
  }>(),
  {
    allPokemonNames: () => [],
    islandPokemon: () => new Set<string>(),
    dragEnabled: false,
    hasItems: false,
  },
)

const emit = defineEmits<{
  'favorite-clicked': [favorite: string]
  'habitat-clicked': [habitat: SpawnHabitat]
  'add-pokemon': [payload: { houseId: string; name: string }]
  'open-mate-modal': []
}>()

const pinStore = usePinStore()

const emptySlots = computed(() => Math.max(0, props.house.capacity - props.house.pokemon.length))

// Inline search on a totally empty house (no pokemon, no cart items): the
// fixed empty model means the appended name is the last payload entry.
function onEmptyHouseInput(names: string[]) {
  const added = names[names.length - 1]
  if (added) emit('add-pokemon', { houseId: props.house.houseId, name: added })
}
</script>

<template>
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
      :spawn-habitats="spawnHabitatsByName?.[name] ?? []"
      :drag-enabled="dragEnabled"
      :house-id="house.houseId"
      context="house"
      @toggle="pinStore.togglePokemonPin(house.houseId, name)"
      @favorite-clicked="emit('favorite-clicked', $event)"
      @habitat-clicked="emit('habitat-clicked', $event)"
    />
    <EmptySlotButton
      v-for="slot in emptySlots"
      :key="`empty-slot-${slot}`"
      :house-id="house.houseId"
      :suggestions-ready="suggestionsReady"
      @click="emit('open-mate-modal')"
    />
  </div>

  <!-- A house with items but no pokemon still gets plus-cards: suggestions
       rank by fulfilled favorites alone. No PokemonCards, no inline input. -->
  <div v-else-if="hasItems && emptySlots > 0" class="pokemon-grid">
    <EmptySlotButton
      v-for="slot in emptySlots"
      :key="`empty-slot-${slot}`"
      :house-id="house.houseId"
      :suggestions-ready="suggestionsReady"
      @click="emit('open-mate-modal')"
    />
  </div>

  <!-- Totally empty house (no pokemon, no items): inline search instead of
       the old "Empty" placeholder (data-testid="empty" is gone). -->
  <PokemonSelect
    v-else
    data-testid="house-empty-input"
    :pokemon-names="allPokemonNames"
    :exclude-names="islandPokemon"
    :model-value="[]"
    placeholder="Add a Pokemon to this house..."
    @update:model-value="onEmptyHouseInput"
  />
</template>
