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
  BToast,
} from 'bootstrap-vue-next'
import { nextTick, ref } from 'vue'

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

// Transient "Island link copied to clipboard" toast; BToast auto-dismisses after
// the delay. Writing the hash back into itself is a no-op; the URL already
// carries the current scenario (History.replaceState in HomeView).
const showToast = ref(false)

async function onShareLink() {
  const url = window.location.href
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Clipboard unavailable (e.g. non-secure context); the toast still
      // confirms the link can be copied from the address bar.
    }
  }
  // Bump modelValue false→true so an already-visible toast restarts its timer.
  showToast.value = false
  await nextTick()
  showToast.value = true
}

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
      <div class="d-flex gap-2 flex-shrink-0 config-card-actions">
        <BButton
          variant="info"
          class="beach-button beach-button--sm share-link-btn"
          data-testid="share-link"
          title="Copy the link to this island"
          @click="onShareLink"
        >
          Share island as a link
          <i class="bi bi-link-45deg" aria-hidden="true"></i>
        </BButton>
        <BButton
          variant="outline-primary"
          class="beach-button beach-button--sm"
          :disabled="!canSave"
          @click="$emit('save')"
        >
          Save current island
        </BButton>
      </div>
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

    <!-- Fixed-position toast host: appears on any block click of Copy link. -->
    <div
      class="share-toast-wrap toast-container position-fixed"
      aria-live="polite"
      aria-atomic="true"
    >
      <BToast
        v-model="showToast"
        :delay="2600"
        variant="info"
        class="share-toast"
        data-testid="share-toast"
      >
        Island link copied to clipboard
      </BToast>
    </div>
  </BCard>
</template>
