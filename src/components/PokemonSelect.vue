<script setup lang="ts">
import { BBadge, BCloseButton, BFormInput, BListGroup, BListGroupItem } from 'bootstrap-vue-next'
import { computed, ref } from 'vue'

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

const filtered = computed(() => {
  const selected = new Set(props.modelValue)
  const q = query.value.toLowerCase()
  return props.pokemonNames.filter((name) => !selected.has(name) && name.toLowerCase().includes(q))
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
    <div v-if="modelValue.length" class="d-flex flex-wrap gap-1 mb-3">
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
    <div class="position-relative pokemon-select-wrap">
      <BFormInput
        v-model="query"
        class="pokemon-search"
        placeholder="Search pokemon..."
        autocomplete="off"
        @input="onInput"
        @keydown="onKeydown"
        @focus="onFocus"
        @blur="onBlur"
      />
      <BListGroup
        v-if="isOpen && filtered.length"
        class="position-absolute w-100 overflow-auto tropical-dropdown"
        style="max-height: 200px; z-index: 10"
      >
        <BListGroupItem
          v-for="(name, i) in filtered.slice(0, 50)"
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
  </div>
</template>
