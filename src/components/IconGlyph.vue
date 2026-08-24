<script setup lang="ts">
import { svgForIcon } from '@/iconSvg'
import { computed } from 'vue'

const props = defineProps<{
  name?: string
}>()

// The glyph is purely decorative: accessible names come from the surrounding
// visible text (habitat badge label, favorite row label, favorite-column
// header), so the wrapper carries aria-hidden="true" and the injected <svg>
// (a trusted build-time constant from the MIT bootstrap-icons package) is
// hidden from the accessibility tree with it.
const markup = computed(() => svgForIcon(props.name ?? ''))
</script>

<template>
  <span v-if="markup" class="icon-glyph" aria-hidden="true" v-html="markup" />
</template>
