<script setup lang="ts">
import { BCard, BCardBody, BCardHeader, BButton, BButtonGroup } from 'bootstrap-vue-next'

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
      <div class="auto-sort-group" data-testid="auto-sort-group">
        <BButtonGroup vertical class="w-100" aria-label="Automatically sort Pokemon">
          <BButton
            :pressed="modelValue"
            :active="modelValue"
            variant="outline-secondary"
            data-testid="auto-sort-auto"
            @click="$emit('update:modelValue', true)"
            >Auto sort</BButton
          >
          <BButton
            :pressed="!modelValue"
            :active="!modelValue"
            variant="outline-secondary"
            data-testid="auto-sort-manual"
            @click="$emit('update:modelValue', false)"
            >Manual sort</BButton
          >
        </BButtonGroup>
      </div>
      <p class="auto-sort-help">
        {{
          modelValue
            ? 'Assignments update as you add Pokémon'
            : 'New Pokémon wait unassigned while this is off'
        }}
      </p>
    </BCardBody>
  </BCard>
</template>
