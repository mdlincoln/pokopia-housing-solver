<script setup lang="ts">
import { BCard } from 'bootstrap-vue-next'
import { computed } from 'vue'

const props = defineProps<{
  name: string
  image: string
  favorites: string[]
}>()

const imgURL = computed(() => `https://pokopia-roommate-matchmaker.netlify.app/${props.image}`)
</script>

<template>
  <BCard :title="name" :img-src="imgURL" style="max-width: 15rem"
    ><template #footer>
      <small v-for="fav in favorites" class="text-body-secondary" :key="fav">{{ fav }} </small>
    </template>
  </BCard>
</template>
