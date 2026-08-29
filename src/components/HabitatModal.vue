<script setup lang="ts">
// Habitat detail modal, opened from a PokemonCard spawn-habitat thumbnail.
// HouseRecord owns one instance per house card; `habitat: null` = closed.
// Detail/sprite lookups go through the cached habitat graph promise in
// @/queries (the only module allowed to read baked data).

import { assetPath } from '@/assetPath'
import IconGlyph from '@/components/IconGlyph.vue'
import {
  getHabitatDetails,
  getPokemonSprites,
  type HabitatDetails,
  type SpawnHabitat,
} from '@/queries'
import { iconForTime, iconForWeather, variantForRarity } from '@/spawnIcons'
import { BAlert, BBadge, BModal, BSpinner } from 'bootstrap-vue-next'
import { ref, watch } from 'vue'

const props = defineProps<{
  habitat: SpawnHabitat | null
}>()

// "close" is the only output: BModal's visibility is fully controlled by
// `:model-value`, so EVERY hide pathway (OK button, ✕, backdrop, Esc) routes
// through @hide → close → the owner nulls its openHabitat ref.
const emit = defineEmits<{
  close: []
}>()

const details = ref<HabitatDetails | null>(null)
const sprites = ref<Record<string, string | null>>({})
const loading = ref(false)
const loadFailed = ref(false)

async function loadDetails(id: number) {
  loading.value = true
  loadFailed.value = false
  details.value = null
  sprites.value = {}
  try {
    const found = await getHabitatDetails(id)
    // Stale-response guard: if the user opened a different habitat while this
    // lookup was in flight, the results below belong to the old id.
    if (props.habitat?.id !== id) return
    if (!found) {
      loadFailed.value = true
      return
    }
    details.value = found
    sprites.value = await getPokemonSprites(found.pokemon.map((spawn) => spawn.name))
    if (props.habitat?.id !== id) {
      details.value = null
      sprites.value = {}
      return
    }
  } catch {
    if (props.habitat?.id === id) loadFailed.value = true
  } finally {
    if (props.habitat?.id === id) loading.value = false
  }
}

watch(
  () => props.habitat,
  (habitat) => {
    if (habitat) {
      void loadDetails(habitat.id)
    } else {
      details.value = null
      sprites.value = {}
      loading.value = false
      loadFailed.value = false
    }
  },
  { immediate: true },
)
</script>

<template>
  <BModal
    :model-value="habitat !== null"
    :title="habitat?.name"
    title-tag="h2"
    ok-only
    ok-title="Close"
    scrollable
    data-testid="habitat-modal"
    @hide="emit('close')"
  >
    <div v-if="loading" class="d-flex justify-content-center habitat-modal-state">
      <BSpinner label="Loading habitat details..." />
    </div>

    <BAlert v-else-if="loadFailed" variant="danger" :model-value="true" class="mb-0">
      Could not load habitat details.
    </BAlert>

    <template v-else-if="details">
      <img
        :src="assetPath(details.image)"
        :alt="details.name"
        class="habitat-modal-image"
        data-testid="habitat-modal-image"
      />
      <p class="habitat-modal-description">{{ details.description }}</p>

      <h3>Pokémon found here</h3>
      <ul class="habitat-modal-roster">
        <li
          v-for="spawn in details.pokemon"
          :key="spawn.name"
          class="habitat-modal-spawn"
          data-testid="habitat-modal-spawn"
        >
          <span class="habitat-modal-spawn-main">
            <img
              v-if="sprites[spawn.name]"
              :src="assetPath(sprites[spawn.name]!)"
              :alt="spawn.name"
              class="habitat-modal-sprite"
            />
            <span class="habitat-modal-spawn-name">{{ spawn.name }}</span>
            <BBadge
              pill
              :variant="variantForRarity(spawn.rarity)"
              data-testid="habitat-modal-rarity"
              >{{ spawn.rarity ?? 'Unknown' }}</BBadge
            >
          </span>
          <span v-if="spawn.times.length" class="habitat-modal-conditions">
            <span class="habitat-modal-row-label">Time</span>
            <span
              v-for="time in spawn.times"
              :key="time"
              class="habitat-modal-chip habitat-modal-chip--time"
              data-testid="habitat-modal-time"
            >
              <IconGlyph :name="iconForTime(time)" />
              {{ time }}
            </span>
          </span>
          <span v-if="spawn.weathers.length" class="habitat-modal-conditions">
            <span class="habitat-modal-row-label">Weather</span>
            <span
              v-for="weather in spawn.weathers"
              :key="weather"
              class="habitat-modal-chip habitat-modal-chip--weather"
              data-testid="habitat-modal-weather"
            >
              <IconGlyph :name="iconForWeather(weather)" />
              {{ weather }}
            </span>
          </span>
          <span class="habitat-modal-locations text-muted" data-testid="habitat-modal-locations">
            {{ spawn.locations.join(', ') }}
          </span>
        </li>
      </ul>
    </template>
  </BModal>
</template>
