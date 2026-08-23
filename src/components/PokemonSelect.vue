<script setup lang="ts">
import { BBadge, BCloseButton, BFormInput, BListGroup, BListGroupItem } from 'bootstrap-vue-next'
import { computed, ref, useId } from 'vue'

const props = defineProps<{
  pokemonNames: string[]
  modelValue: string[]
  pinnedNames?: Set<string>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const query = ref('')
const isOpen = ref(false)
const highlightIndex = ref(0)

// ARIA combobox wiring: ideas come from https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
// — focus stays on the input and the highlighted option is referenced via
// aria-activedescendant (ids must be unique per component instance).
const listboxId = `${useId()}-listbox`

const filtered = computed(() => {
  const selected = new Set(props.modelValue)
  const q = query.value.toLowerCase()
  return props.pokemonNames.filter((name) => !selected.has(name) && name.toLowerCase().includes(q))
})

// The dropdown renders at most 50 options; activedescendant must reference one
// of those rendered option ids (or nothing, when the list is closed/empty).
const activeDescendantId = computed(() => {
  if (!isOpen.value || filtered.value.length === 0) return undefined
  const index = Math.min(highlightIndex.value, Math.min(filtered.value.length, 50) - 1)
  return `${listboxId}-option-${index}`
})

// Polite announcements of the current match count. The region stays mounted
// unconditionally so updates are never missed due to live-region registration
// races.
const liveAnnouncement = computed(() => {
  if (!isOpen.value) return ''
  const count = filtered.value.length
  if (count === 0) return 'No Pokémon match'
  return count === 1 ? '1 Pokémon matches' : `${count} Pokémon match`
})

function select(name: string) {
  emit('update:modelValue', [...props.modelValue, name])
  query.value = ''
  highlightIndex.value = 0
  isOpen.value = false
}

function remove(name: string) {
  emit(
    'update:modelValue',
    props.modelValue.filter((n) => n !== name),
  )
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    isOpen.value = true
    highlightIndex.value = Math.min(highlightIndex.value + 1, filtered.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    highlightIndex.value = Math.max(highlightIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = filtered.value[highlightIndex.value]
    if (item) select(item)
  } else if (e.key === 'Escape') {
    isOpen.value = false
  }
}

function onInput() {
  isOpen.value = true
  highlightIndex.value = 0
}

function onFocus() {
  isOpen.value = true
}

function onBlur() {
  setTimeout(() => {
    isOpen.value = false
  }, 150)
}
</script>

<template>
  <div class="pokemon-select">
    <div class="position-relative pokemon-select-wrap">
      <BFormInput
        v-model="query"
        class="pokemon-search"
        placeholder="Add pokemon to your island..."
        autocomplete="off"
        aria-label="Search Pokémon to add"
        role="combobox"
        aria-haspopup="listbox"
        :aria-expanded="String(isOpen && filtered.length > 0)"
        :aria-controls="listboxId"
        :aria-activedescendant="activeDescendantId"
        @input="onInput"
        @keydown="onKeydown"
        @focus="onFocus"
        @blur="onBlur"
      />
      <span class="visually-hidden" aria-live="polite" data-testid="pokemon-search-status">{{
        liveAnnouncement
      }}</span>
      <BListGroup
        v-if="isOpen && filtered.length"
        :id="listboxId"
        role="listbox"
        class="position-absolute w-100 overflow-auto tropical-dropdown"
      >
        <BListGroupItem
          v-for="(name, i) in filtered.slice(0, 50)"
          :id="`${listboxId}-option-${i}`"
          :key="name"
          role="option"
          :active="i === highlightIndex"
          button
          @mousedown.prevent="select(name)"
        >
          {{ name }}
        </BListGroupItem>
      </BListGroup>
    </div>
    <div v-if="modelValue.length" class="d-flex flex-wrap gap-1 mt-2">
      <BBadge
        v-for="name in modelValue"
        :key="name"
        variant="primary"
        pill
        class="d-inline-flex align-items-center gap-1 pe-1 favorite-pill"
      >
        {{ name }}
        <BCloseButton class="ms-1" :disabled="props.pinnedNames?.has(name)" @click="remove(name)" />
      </BBadge>
    </div>
  </div>
</template>
