<script setup lang="ts">
import {
  BAlert,
  BButton,
  BCard,
  BCardBody,
  BCardFooter,
  BCardHeader,
  BFormGroup,
  BFormSelect,
  BInputGroup,
} from 'bootstrap-vue-next'

interface SavedQuery {
  title: string
  timestamp: number
}

defineProps<{
  savedQueries: SavedQuery[]
  selectedTimestamp: number | null
  saveSuccess: boolean
  deletedUndoTitle: string
  canSave: boolean
}>()

const emit = defineEmits<{
  'update:selectedTimestamp': [value: number | null]
  save: []
  manage: []
  undo: []
}>()

// BFormSelect's model update can be a number, an array (multi-select), or
// null; this select is single, so normalize non-number payloads to null.
function onSelectTimestamp(value: number | (number | null)[] | null) {
  emit('update:selectedTimestamp', typeof value === 'number' ? value : null)
}

function optionText(q: SavedQuery): string {
  return q.title
    ? `${q.title} (${new Date(q.timestamp).toLocaleString()})`
    : new Date(q.timestamp).toLocaleString()
}
</script>

<template>
  <BCard class="shell-card islands-card h-100 config-card" data-testid="islands-card">
    <BCardHeader class="config-card-header">
      <h2 class="section-heading mb-0">Saved islands</h2>
      <BButton
        variant="outline-primary"
        class="beach-button beach-button--sm"
        :disabled="!canSave"
        @click="$emit('save')"
      >
        Save current island
      </BButton>
    </BCardHeader>
    <BCardBody class="shell-card-body">
      <BAlert
        v-if="deletedUndoTitle"
        variant="warning"
        :model-value="true"
        class="mb-2 status-alert"
        data-testid="saved-query-deleted"
      >
        Deleted "{{ deletedUndoTitle }}".
        <BButton
          variant="outline-dark"
          class="ms-2 beach-button beach-button--sm"
          data-testid="saved-query-undo"
          @click="$emit('undo')"
          >Undo</BButton
        >
      </BAlert>

      <BFormGroup v-if="savedQueries.length" class="mt-2 mb-0">
        <BInputGroup>
          <BFormSelect
            id="saved-queries-select"
            :model-value="selectedTimestamp"
            :options="[
              { value: null, text: 'Select a saved island…' },
              ...savedQueries.map((q) => ({
                value: q.timestamp,
                text: optionText(q),
              })),
            ]"
            @update:model-value="onSelectTimestamp($event)"
          />
          <template #append>
            <BButton
              variant="outline-secondary"
              class="beach-button beach-button--sm"
              data-testid="saved-queries-manage"
              @click="$emit('manage')"
            >
              Manage saved islands
            </BButton>
          </template>
        </BInputGroup>
      </BFormGroup>

      <BAlert
        v-if="saveSuccess"
        variant="success"
        :model-value="true"
        class="mb-0 status-alert mt-2"
      >
        Island saved.
      </BAlert>
    </BCardBody>
    <BCardFooter class="small text-muted">
      Saved to this browser only — nothing leaves your computer.
    </BCardFooter>
  </BCard>
</template>
