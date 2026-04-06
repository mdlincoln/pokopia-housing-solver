<script setup lang="ts">
import { BBadge, BCard } from 'bootstrap-vue-next'
import { computed } from 'vue'

const props = defineProps<{
  name: string
  image: string
  favorites: string[]
  habitat?: string
}>()

const imgURL = computed(() => `https://pokopia-roommate-matchmaker.netlify.app/${props.image}`)

const HABITAT_VARIANT: Record<string, string> = {
  Dark: 'dark',
  Bright: 'warning',
  Cool: 'info',
  Warm: 'danger',
  Dry: 'secondary',
  Humid: 'success',
}

const habitatVariant = computed(() =>
  props.habitat ? (HABITAT_VARIANT[props.habitat] ?? 'light') : null,
)
</script>

<template>
  <BCard :title="name" :img-src="imgURL" style="max-width: 15rem"
    ><template #footer>
      <BBadge
        v-if="habitat && habitatVariant"
        :variant="habitatVariant"
        pill
        class="me-1 mb-1"
        data-testid="habitat-badge"
      >
        {{ habitat }}
      </BBadge>
      <small v-for="fav in favorites" class="text-body-secondary" :key="fav">{{ fav }} </small>
    </template>
  </BCard>
</template>
