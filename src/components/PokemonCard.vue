<script setup lang="ts">
import { assetPath } from '@/assetPath'
import IconGlyph from '@/components/IconGlyph.vue'
import { iconForFavorite } from '@/favoriteIcons'
import { HABITAT_VARIANT, iconForHabitat } from '@/habitats'
import type { SpawnHabitat } from '@/queries'
import { BBadge, BCard, BCardImg, BCol, BRow } from 'bootstrap-vue-next'
import { computed } from 'vue'

const props = defineProps<{
  name: string
  image: string
  favorites: string[]
  habitat?: string
  checked?: boolean
  fulfilledFavorites?: Set<string>
  spawnHabitats?: SpawnHabitat[]
}>()

const emit = defineEmits<{
  favoriteClicked: [favorite: string]
  habitatClicked: [habitat: SpawnHabitat]
  toggle: []
}>()

const imgURL = computed(() => assetPath(props.image))

const habitatVariant = computed(() =>
  props.habitat ? (HABITAT_VARIANT[props.habitat] ?? 'light') : null,
)
</script>

<template>
  <BCard no-body class="overflow-hidden pokemon-card" :class="{ 'checked-off': checked }">
    <BRow class="g-0 align-items-start gap-2 pokemon-card-header">
      <BCol class="pokemon-name-col">
        <h4 class="card-title mb-0 pokemon-name">{{ name }}</h4>
      </BCol>
      <BCol cols="auto">
        <button
          type="button"
          role="checkbox"
          :aria-checked="checked"
          :aria-label="checked ? `Unpin ${name}` : `Pin ${name} to this house`"
          class="btn btn-link p-0 pin-icon"
          data-testid="progress-checkbox-pokemon"
          @click="emit('toggle')"
          title="Pin this pokemon to this house so it stays when re-solving"
        >
          <i :class="checked ? 'bi bi-lock-fill' : 'bi bi-unlock'"></i>
        </button>
      </BCol>
    </BRow>

    <BRow class="g-0">
      <BCol cols="auto">
        <BCardImg :src="imgURL" :alt="name" class="pokemon-avatar" />
      </BCol>
      <BCol class="d-flex flex-column align-items-start justify-content-center">
        <div v-if="habitat && habitatVariant">
          <BBadge :variant="habitatVariant" pill data-testid="habitat-badge">
            <IconGlyph :name="iconForHabitat(habitat)" />
            {{ habitat }}
          </BBadge>
        </div>
        <div v-if="spawnHabitats?.length" class="habitat-thumbs" data-testid="habitat-thumbs">
          <button
            v-for="spawnHabitat in spawnHabitats"
            :key="spawnHabitat.id"
            type="button"
            class="habitat-thumb"
            data-testid="habitat-thumb"
            :aria-label="`View ${spawnHabitat.name} habitat details`"
            :title="spawnHabitat.name"
            @click="emit('habitatClicked', spawnHabitat)"
          >
            <img :src="assetPath(spawnHabitat.image)" :alt="spawnHabitat.name" loading="lazy" />
          </button>
        </div>
      </BCol>
    </BRow>
    <table v-if="favorites.length" class="table table-sm mb-0 pokemon-favorites-table">
      <thead>
        <tr>
          <th scope="col"><span class="visually-hidden">Favorite</span></th>
          <th scope="col" class="bool-col"><span class="visually-hidden">Fulfilled</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="fav in favorites" :key="fav">
          <td>
            <button
              type="button"
              class="btn btn-link p-0 favorite-need"
              data-testid="fave-badge"
              title="Click to view items that fulfill this favorite"
              @click="emit('favoriteClicked', fav)"
            >
              <IconGlyph :name="iconForFavorite(fav)" />
              {{ fav }}
            </button>
          </td>
          <td class="bool-col">
            <span v-if="fulfilledFavorites?.has(fav)" class="bool-check">✓</span>
          </td>
        </tr>
      </tbody>
    </table>
  </BCard>
</template>
