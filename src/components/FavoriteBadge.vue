<script setup lang="ts">
import { BBadge } from 'bootstrap-vue-next'

const props = defineProps<{
  favorite: string
  fulfilled?: boolean
  informational?: boolean // renders as secondary with no ✓/✗ prefix; overrides fulfilled
  count?: number
}>()

const emit = defineEmits<{
  click: [favorite: string]
}>()

function variant() {
  if (props.informational) return 'secondary'
  return props.fulfilled ? 'success' : 'danger'
}

function prefix() {
  if (props.informational) return ''
  return props.fulfilled ? '✓' : '✗'
}
</script>

<template>
  <BBadge
    :variant="variant()"
    pill
    class="me-1 mb-1 favorite-pill"
    role="button"
    tabindex="0"
    title="Click to view items that fulfill this favorite"
    @click="emit('click', favorite)"
    @keydown.enter.prevent="emit('click', favorite)"
    @keydown.space.prevent="emit('click', favorite)"
  >
    <template v-if="prefix()">{{ prefix() }} </template>{{ favorite
    }}<template v-if="count !== undefined"> &times;{{ count }}</template>
  </BBadge>
</template>
