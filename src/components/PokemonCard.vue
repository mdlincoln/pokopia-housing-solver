<script setup lang="ts">
import { assetPath } from '@/assetPath'
import { HABITAT_VARIANT } from '@/habitats'
import { BBadge, BCard, BCardBody, BCardImg, BCol, BRow } from 'bootstrap-vue-next'
import { computed } from 'vue'

const props = defineProps<{
  name: string
  image: string
  favorites: string[]
  habitat?: string
  checked?: boolean
  fulfilledFavorites?: Set<string>
}>()

const emit = defineEmits<{
  favoriteClicked: [favorite: string]
  toggle: []
}>()

function handleFavoriteClick(favorite: string) {
  emit('favoriteClicked', favorite)
}

const imgURL = computed(() => assetPath(props.image))

const habitatVariant = computed(() =>
  props.habitat ? (HABITAT_VARIANT[props.habitat] ?? 'light') : null,
)
</script>

<template>
  <BCard no-body class="overflow-hidden pokemon-card" :class="{ 'checked-off': checked }">
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
          <div class="mb-1">
            <input
              type="checkbox"
              :checked="checked"
              class="form-check-input me-1"
              data-testid="progress-checkbox-pokemon"
              @change="emit('toggle')"
              title="Pin this pokemon to this house so it stays when re-solving"
            />
          </div>
          <div v-if="habitat && habitatVariant">
            <BBadge :variant="habitatVariant" pill class="me-1 mb-1" data-testid="habitat-badge">
              {{ habitat }}
            </BBadge>
          </div>
          <div v-if="favorites">
            <BBadge
              v-for="fav in favorites"
              :key="fav"
              :variant="fulfilledFavorites?.has(fav.toLowerCase()) ? 'success' : undefined"
              pill
              class="me-1 mb-1 favorite-pill"
              data-testid="fave-badge"
              role="button"
              tabindex="0"
              title="Click to view items that fulfill this favorite"
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
