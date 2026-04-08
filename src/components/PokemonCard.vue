<script setup lang="ts">
import {
  BBadge,
  BCard,
  BCardBody,
  BCardImg,
  BCol,
  BRow,
  type ColorVariant,
} from 'bootstrap-vue-next'
import { computed } from 'vue'

const props = defineProps<{
  name: string
  image: string
  favorites: string[]
  habitat?: string
}>()

const emit = defineEmits<{
  favoriteClicked: [favorite: string]
}>()

function handleFavoriteClick(favorite: string) {
  emit('favoriteClicked', favorite)
}

const imgURL = computed(() => `https://pokopia-roommate-matchmaker.netlify.app/${props.image}`)

const HABITAT_VARIANT: Record<string, ColorVariant> = {
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
  <BCard no-body class="overflow-hidden pokemon-card">
    <BRow class="g-0">
      <BCol cols="auto">
        <BCardImg
          :src="imgURL"
          :alt="name"
          class="rounded-0 m-2 pokemon-avatar"
          style="width: 6rem"
        />
      </BCol>
      <BCol>
        <BCardBody :title="name" class="pokemon-card-body">
          <div v-if="habitat && habitatVariant">
            <BBadge :variant="habitatVariant" pill class="me-1 mb-1" data-testid="habitat-badge">
              {{ habitat }}
            </BBadge>
          </div>
          <div v-if="favorites">
            <BBadge
              v-for="fav in favorites"
              :key="fav"
              pill
              class="me-1 mb-1 favorite-pill"
              data-testid="fave-badge"
              role="button"
              tabindex="0"
              @click="handleFavoriteClick(fav)"
              @keydown.enter.prevent="handleFavoriteClick(fav)"
              @keydown.space.prevent="handleFavoriteClick(fav)"
            >
              {{ fav }}
            </BBadge>
          </div>
        </BCardBody>
      </BCol>
    </BRow>
  </BCard>
</template>
