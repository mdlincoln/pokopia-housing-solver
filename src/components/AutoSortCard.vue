<script setup lang="ts">
import { BCard, BCardBody, BCardHeader, BFormCheckbox } from 'bootstrap-vue-next'

defineProps<{
  modelValue: boolean
}>()

defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <BCard
    class="shell-card top-gradient-card h-100 config-card"
    :class="{ 'autosort-card--off': !modelValue }"
    data-testid="autosort-card"
  >
    <BCardHeader class="config-card-header">
      <h2 class="section-heading mb-0">Automatically sort Pokemon</h2>
    </BCardHeader>
    <BCardBody class="shell-card-body">
      <BFormCheckbox
        switch
        :model-value="modelValue"
        data-testid="autosort-switch"
        aria-label="Automatically sort Pokemon"
        class="autosort-switch-item"
        @update:model-value="$emit('update:modelValue', $event === true)"
      >
        {{
          modelValue
            ? 'Assignments update as you add Pokémon'
            : 'New Pokémon wait unassigned while this is off'
        }}
      </BFormCheckbox>
    </BCardBody>
  </BCard>
</template>
