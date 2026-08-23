<script setup lang="ts">
import { BButton, BCard, BCardBody, BCardHeader } from 'bootstrap-vue-next'
import PokemonSelect from '@/components/PokemonSelect.vue'

defineProps<{
  selectedPokemon: string[]
  pokemonNames: string[]
  pinnedNames: Set<string>
}>()

defineEmits<{
  'update:selectedPokemon': [value: string[]]
  clearAll: []
}>()
</script>

<template>
  <BCard class="shell-card top-gradient-card h-100 config-card" data-testid="pokemon-search-card">
    <BCardHeader class="config-card-header">
      <h5 class="section-heading mb-0">Pokémon</h5>
      <BButton
        variant="outline-danger"
        class="beach-button beach-button--sm"
        :disabled="selectedPokemon.length === 0"
        @click="$emit('clearAll')"
      >
        Clear all
      </BButton>
    </BCardHeader>
    <BCardBody class="shell-card-body">
      <PokemonSelect
        :model-value="selectedPokemon"
        :pokemon-names="pokemonNames"
        :pinned-names="pinnedNames"
        @update:model-value="$emit('update:selectedPokemon', $event)"
      />
    </BCardBody>
  </BCard>
</template>
