<script setup lang="ts">
import { assetPath } from '@/assetPath'
import FavoriteBadge from '@/components/FavoriteBadge.vue'
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
            <button
              type="button"
              role="checkbox"
              :aria-checked="checked"
              class="btn btn-link p-0 me-1 pin-icon"
              data-testid="progress-checkbox-pokemon"
              @click="emit('toggle')"
              title="Pin this pokemon to this house so it stays when re-solving"
            >
              <i :class="checked ? 'bi bi-lock-fill' : 'bi bi-unlock'"></i>
            </button>
          </div>
          <div v-if="habitat && habitatVariant">
            <BBadge :variant="habitatVariant" pill class="me-1 mb-1" data-testid="habitat-badge">
              {{ habitat }}
            </BBadge>
          </div>
          <div v-if="favorites">
            <FavoriteBadge
              v-for="fav in favorites"
              :key="fav"
              :favorite="fav"
              :fulfilled="fulfilledFavorites?.has(fav.toLowerCase()) ?? false"
              data-testid="fave-badge"
            />
          </div>
        </BCardBody>
      </BCol>
    </BRow>
  </BCard>
</template>
