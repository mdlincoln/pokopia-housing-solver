<script setup lang="ts">
import { assetPath } from '@/assetPath'
import IconGlyph from '@/components/IconGlyph.vue'
import { iconForFavorite } from '@/favoriteIcons'
import { HABITAT_VARIANT, iconForHabitat } from '@/habitats'
import type { SpawnHabitat } from '@/queries'
import { BBadge, BCard, BCardImg, BCol, BRow } from 'bootstrap-vue-next'
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    image: string
    favorites: string[]
    habitat?: string
    checked?: boolean
    fulfilledFavorites?: Set<string>
    spawnHabitats?: SpawnHabitat[]
    // Drag awareness (see HomeView's pointer-events drag). The card stays
    // presentational: it only renders the affordance + data attributes; HomeView
    // owns the actual gesture. `context` selects the housed vs. unhoused variant.
    dragEnabled?: boolean
    context?: 'house' | 'unhoused'
    houseId?: string | null
  }>(),
  {
    checked: false,
    dragEnabled: false,
    context: 'house',
    houseId: null,
  },
)

const emit = defineEmits<{
  favoriteClicked: [favorite: string]
  habitatClicked: [habitat: SpawnHabitat]
  toggle: []
}>()

const imgURL = computed(() => assetPath(props.image))

const habitatVariant = computed(() =>
  props.habitat ? (HABITAT_VARIANT[props.habitat] ?? 'light') : null,
)

// The lock button only exists in the housed variant — the unhoused warning owns
// no pin controls (it has no HouseRecord owner to bind a toggle to).
const showPin = computed(() => props.context === 'house')

// A relocatable card (unlocked, or in the unhoused warning) always shows the
// move affordance. While auto-sort is ON the drag gesture is inactive, so the
// handle renders disabled with a tooltip; dragging only arms while OFF. Pinned
// cards stay handle-less (they can't be moved at all).
const movable = computed(() => props.context === 'unhoused' || !props.checked)
const draggable = computed(() => props.dragEnabled && movable.value)
const dragDisabled = computed(() => movable.value && !props.dragEnabled)

// Shown on the handle while auto-sort is ON to explain why the card can't be
// manually moved right now.
const DRAG_DISABLED_TOOLTIP = 'Pokemon can only be moved manually when Auto-sort is off.'

// The explanation is a fixed-position tooltip drawn from the handle's rect on
// hover, so it always displays and isn't clipped by the card's overflow-hidden
// (a native `title` would be delayed + cut off). The handle is aria-hidden, so
// this is a visual affordance only — drag remains a pointer-only enhancement.
const dragTooltip = ref<{ x: number; y: number } | null>(null)

function showDragTooltip(e: MouseEvent) {
  if (!dragDisabled.value) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  dragTooltip.value = { x: rect.left + rect.width / 2, y: rect.top }
}
function hideDragTooltip() {
  dragTooltip.value = null
}
</script>

<template>
  <BCard
    no-body
    class="overflow-hidden pokemon-card"
    data-testid="pokemon-card"
    data-drag-source
    :class="{
      'checked-off': checked,
      'pokemon-card--draggable': draggable,
    }"
    :data-drag-name="name"
    :data-from-house="houseId ?? ''"
    :data-draggable="draggable ? 'true' : 'false'"
  >
    <BRow class="g-0 align-items-start gap-2 pokemon-card-header">
      <BCol class="pokemon-name-col">
        <h4 class="card-title mb-0 pokemon-name">{{ name }}</h4>
      </BCol>
      <BCol cols="auto">
        <div class="d-flex align-items-center">
          <span
            v-if="movable"
            class="pokemon-drag-handle"
            :class="{ 'pokemon-drag-handle--disabled': dragDisabled }"
            aria-hidden="true"
            @mouseenter="showDragTooltip"
            @mouseleave="hideDragTooltip"
            @focus="hideDragTooltip"
          >
            <i class="bi bi-arrows-move"></i>
          </span>
          <button
            v-if="showPin"
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
        </div>
      </BCol>
    </BRow>

    <div
      v-if="dragTooltip"
      class="pokemon-drag-tooltip"
      :style="{ left: dragTooltip.x + 'px', top: dragTooltip.y + 'px' }"
    >
      {{ DRAG_DISABLED_TOOLTIP }}
    </div>

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
        <div
          v-if="context === 'house' && spawnHabitats?.length"
          class="habitat-thumbs"
          data-testid="habitat-thumbs"
        >
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
              v-if="context === 'house'"
              type="button"
              class="btn btn-link p-0 favorite-need"
              data-testid="fave-badge"
              title="Click to view items that fulfill this favorite"
              @click="emit('favoriteClicked', fav)"
            >
              <IconGlyph :name="iconForFavorite(fav)" />
              {{ fav }}
            </button>
            <span v-else class="favorite-need">
              <IconGlyph :name="iconForFavorite(fav)" />
              {{ fav }}
            </span>
          </td>
          <td class="bool-col">
            <span v-if="fulfilledFavorites?.has(fav)" class="bool-check">✓</span>
          </td>
        </tr>
      </tbody>
    </table>
  </BCard>
</template>
