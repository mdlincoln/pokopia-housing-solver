<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  pokemonNames: string[]
  modelValue: string[]
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
  // Delay to allow click on dropdown items
  setTimeout(() => {
    isOpen.value = false
  }, 150)
}
</script>

<template>
  <div class="pokemon-select">
    <div v-if="modelValue.length" class="chips">
      <span v-for="name in modelValue" :key="name" class="chip">
        {{ name }}
        <button type="button" class="chip-remove" @click="remove(name)">&times;</button>
      </span>
    </div>
    <div class="input-wrapper">
      <input
        v-model="query"
        type="text"
        placeholder="Search pokemon..."
        autocomplete="off"
        @input="onInput"
        @keydown="onKeydown"
        @focus="onFocus"
        @blur="onBlur"
      />
      <ul v-if="isOpen && filtered.length" class="dropdown" role="listbox">
        <li
          v-for="(name, i) in filtered.slice(0, 50)"
          :key="name"
          role="option"
          :class="{ highlighted: i === highlightIndex }"
          @mousedown.prevent="select(name)"
        >
          {{ name }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.pokemon-select {
  position: relative;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.5rem;
  background: #e0e7ff;
  border-radius: 1rem;
  font-size: 0.85rem;
}

.chip-remove {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0;
  color: #666;
}

.input-wrapper {
  position: relative;
}

.input-wrapper input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 0.25rem;
  font-size: 0.9rem;
  box-sizing: border-box;
}

.dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 200px;
  overflow-y: auto;
  background: white;
  border: 1px solid #ccc;
  border-top: none;
  border-radius: 0 0 0.25rem 0.25rem;
  list-style: none;
  margin: 0;
  padding: 0;
  z-index: 10;
}

.dropdown li {
  padding: 0.4rem 0.5rem;
  cursor: pointer;
  font-size: 0.9rem;
}

.dropdown li:hover,
.dropdown li.highlighted {
  background: #e0e7ff;
}
</style>
