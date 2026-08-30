<script setup lang="ts">
import PokemonCard from '@/components/PokemonCard.vue'
import { type DropTarget } from '@/composables/usePokemonDrag'
import { type PokemonData } from '@/solver'
import { BAlert } from 'bootstrap-vue-next'

defineProps<{
  autoSort: boolean
  displayedUnhoused: string[]
  pokemonData: PokemonData
  dragOverTarget: DropTarget | null
}>()
</script>

<template>
  <BAlert
    v-if="!autoSort || displayedUnhoused.length"
    variant="warning"
    :model-value="true"
    data-testid="unhoused"
    class="mt-3"
  >
    <template v-if="autoSort">
      <h3 class="alert-heading">Not enough housing</h3>
      <p class="mb-1">Add houses above to place these Pokémon:</p>
    </template>
    <template v-else>
      <h3 class="alert-heading">Unhoused pokemon</h3>
      <p class="mb-1">Drag a Pokémon from a house into this area to unhouse it.</p>
    </template>
    <div
      class="unhoused-grid drop-zone"
      data-testid="unhoused-pokemon-grid"
      data-drop-zone="unhoused"
      :class="{ 'drop-zone--over': dragOverTarget?.type === 'unhoused' }"
    >
      <PokemonCard
        v-for="name in displayedUnhoused"
        :key="name"
        :name="name"
        :image="pokemonData[name]?.image ?? ''"
        :favorites="pokemonData[name]?.favorites ?? []"
        :habitat="pokemonData[name]?.habitat"
        context="unhoused"
        :house-id="null"
        :drag-enabled="!autoSort"
      />
      <!-- While auto-sort is off the alert always renders so it is a persistent
           drop target; when empty, a dashed placeholder keeps that space
           visible (and droppable) instead of collapsing to zero height. -->
      <p
        v-if="!autoSort && displayedUnhoused.length === 0"
        class="unhoused-empty-hint"
        data-testid="unhoused-empty-hint"
      >
        Drop a Pokémon here to unhouse it
      </p>
    </div>
  </BAlert>
</template>
