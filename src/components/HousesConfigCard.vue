<script setup lang="ts">
import { BButton, BCard, BCardBody, BCardHeader, BFormSpinbutton } from 'bootstrap-vue-next'

defineProps<{
  small: number
  medium: number
  large: number
  minSmall: number
  minMedium: number
  minLarge: number
}>()

defineEmits<{
  'update:small': [value: number]
  'update:medium': [value: number]
  'update:large': [value: number]
  clearAll: []
}>()
</script>

<template>
  <BCard class="shell-card top-gradient-card h-100 config-card" data-testid="houses-card">
    <BCardHeader class="config-card-header">
      <h5 class="section-heading mb-0">Houses</h5>
      <BButton
        variant="outline-danger"
        class="beach-button beach-button--sm"
        :disabled="small === 0 && medium === 0 && large === 0"
        @click="$emit('clearAll')"
      >
        Clear all
      </BButton>
    </BCardHeader>
    <BCardBody class="shell-card-body">
      <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
        <label class="mb-0 flex-grow-1" for="house-small">Small (1 slot)</label>
        <BFormSpinbutton
          id="house-small"
          :model-value="small"
          :min="minSmall"
          class="house-count-input"
          @update:model-value="$emit('update:small', $event ?? 0)"
        />
      </div>
      <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
        <label class="mb-0 flex-grow-1" for="house-medium">Medium (2 slots)</label>
        <BFormSpinbutton
          id="house-medium"
          :model-value="medium"
          :min="minMedium"
          class="house-count-input"
          @update:model-value="$emit('update:medium', $event ?? 0)"
        />
      </div>
      <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
        <label class="mb-0 flex-grow-1" for="house-large">Large (4 slots)</label>
        <BFormSpinbutton
          id="house-large"
          :model-value="large"
          :min="minLarge"
          class="house-count-input"
          @update:model-value="$emit('update:large', $event ?? 0)"
        />
      </div>
    </BCardBody>
  </BCard>
</template>
