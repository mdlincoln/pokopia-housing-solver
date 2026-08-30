<script setup lang="ts">
import { type SavedQuery } from '@/composables/useSavedQueries'
import { BButton, BModal } from 'bootstrap-vue-next'

defineProps<{
  modelValue: boolean
  savedQueries: SavedQuery[]
}>()

defineEmits<{
  'update:modelValue': [value: boolean]
  delete: [timestamp: number]
}>()
</script>

<template>
  <BModal
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    title="Saved islands"
    title-tag="h2"
    data-testid="saved-queries-modal"
    hide-footer
  >
    <p v-if="!savedQueries.length" class="text-muted mb-0">No saved islands.</p>
    <ul v-else class="list-group">
      <li
        v-for="q in savedQueries"
        :key="q.timestamp"
        class="list-group-item d-flex justify-content-between align-items-center gap-2"
      >
        <span>
          {{ q.title || new Date(q.timestamp).toLocaleString() }}
          <span v-if="q.title" class="text-muted"
            >({{ new Date(q.timestamp).toLocaleString() }})</span
          >
        </span>
        <BButton
          variant="outline-danger"
          class="beach-button beach-button--sm"
          data-testid="saved-query-delete"
          :aria-label="`Delete saved island ${q.title || new Date(q.timestamp).toLocaleString()}`"
          @click="$emit('delete', q.timestamp)"
        >
          Delete
        </BButton>
      </li>
    </ul>
  </BModal>
</template>
