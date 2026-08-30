<script setup lang="ts">
import { BFormGroup, BFormInput, BModal } from 'bootstrap-vue-next'

defineProps<{
  modelValue: boolean
  title: string
}>()

defineEmits<{
  'update:modelValue': [value: boolean]
  'update:title': [value: string]
  ok: []
  enter: []
}>()
</script>

<template>
  <BModal
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    title="Save island"
    title-tag="h2"
    ok-title="Save"
    ok-variant="primary"
    cancel-variant="secondary"
    @ok="$emit('ok')"
  >
    <BFormGroup label="Title (optional)" label-for="query-title-input">
      <BFormInput
        id="query-title-input"
        :model-value="title"
        @update:model-value="$emit('update:title', String($event ?? ''))"
        placeholder="e.g. My island layout"
        @keydown.enter.prevent="$emit('enter')"
      />
    </BFormGroup>
  </BModal>
</template>
