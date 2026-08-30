<script setup lang="ts">
defineProps<{
  houseId: string
  suggestionsReady: boolean
}>()

defineEmits<{
  click: []
}>()
</script>

<template>
  <button
    type="button"
    class="house-empty-slot"
    data-testid="house-empty-slot"
    :disabled="!suggestionsReady"
    :aria-label="`Add a Pokémon to house ${houseId}`"
    :title="
      suggestionsReady
        ? `Find the best fitting Pokemon to join house ${houseId}`
        : 'Compatibility data is still loading — suggestions are temporarily unavailable'
    "
    @click="$emit('click')"
  >
    <i class="bi bi-plus-lg" aria-hidden="true"></i>
  </button>
</template>
