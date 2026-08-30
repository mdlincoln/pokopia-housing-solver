<script setup lang="ts">
// House-mate suggestion modal, opened from a HouseRecord empty-slot ("+")
// card. HouseRecord owns one instance per house card; `house: null` = closed.
// Matches are computed lazily by the owner via topHouseMates (@/queries) and
// handed in as a prop: null = loading (spinner), [] = no qualifying
// candidates (empty state + search fallback).

import { assetPath } from '@/assetPath'
import PokemonSelect from '@/components/PokemonSelect.vue'
import { HABITAT_VARIANT } from '@/habitats'
import type { HouseMateMatch } from '@/queries'
import type { HouseAssignment } from '@/solver'
import { BAlert, BBadge, BFormCheckbox, BModal, BSpinner } from 'bootstrap-vue-next'
import { computed } from 'vue'

const props = defineProps<{
  house: HouseAssignment | null
  matches: HouseMateMatch[] | null
  allPokemonNames: string[]
  excludedNames: ReadonlySet<string>
  // True when the occupant list is empty (items-only ranking tier): the
  // search box provides the arbitrary-pick path when ranking inputs are thin.
  showSearch: boolean
  // Whether island-wide auto-sort is on: gates the re-sort warning rendered
  // at the top of the modal body, whose switch flips it off via emit below.
  autoSort: boolean
}>()

const emit = defineEmits<{
  select: [name: string]
  close: []
  'update:autoSort': [value: boolean]
}>()

// The search input renders when requested (items-only tier) OR whenever the
// ranked list resolved to [] — the user must never hit a dead-end modal.
const searchVisible = computed(
  () => props.matches !== null && (props.showSearch || props.matches.length === 0),
)

function onSelect(name: string) {
  emit('select', name)
  emit('close')
}

// PokemonSelect is driven with a fixed empty model (chips never render); the
// newly appended name is the last entry of the update payload.
function onSearchUpdate(names: string[]) {
  const added = names[names.length - 1]
  if (added) onSelect(added)
}
</script>

<template>
  <BModal
    :model-value="house !== null"
    title="The best fitting Pokemon to join this house"
    title-tag="h2"
    ok-only
    ok-title="Close"
    scrollable
    data-testid="housemate-modal"
    @hide="emit('close')"
  >
    <!-- Auto-sort warning: adding a pokemon (via a ranked suggestion row or the
         manual search below) triggers an island-wide re-sort while auto-sort is
         on. Rendered as the modal body's first child so it sits above the
         spinner, suggestion rows, and fallback search alike. -->
    <BAlert
      v-if="autoSort"
      variant="warning"
      :model-value="true"
      class="housemate-autosort-warning"
      data-testid="housemate-autosort-warning"
    >
      <p class="mb-2">
        Because auto-sort is currently <strong>ON</strong>, adding this pokemon will trigger your
        entire island to re-sort. This new pokemon will stay in this house, but auto-sort may move
        your other, unpinned housemates to more optimal houses.
      </p>
      <BFormCheckbox
        switch
        :model-value="autoSort"
        class="autosort-switch-item mb-0"
        data-testid="housemate-autosort-switch"
        @update:model-value="$emit('update:autoSort', $event === true)"
      >
        Switch auto-sort off before you add a Pokemon?
      </BFormCheckbox>
    </BAlert>

    <div v-if="matches === null" class="d-flex justify-content-center housemate-modal-state">
      <BSpinner label="Loading house-mate suggestions..." />
    </div>

    <template v-else>
      <div v-if="matches.length" class="housemate-options">
        <button
          v-for="match in matches"
          :key="match.name"
          type="button"
          class="housemate-option"
          data-testid="housemate-option"
          :aria-label="`Add ${match.name} to house ${house?.houseId ?? ''}`"
          @click="onSelect(match.name)"
        >
          <span class="housemate-option-main">
            <img
              v-if="match.image"
              :src="assetPath(match.image)"
              :alt="match.name"
              class="housemate-sprite"
            />
            <span class="housemate-option-name">{{ match.name }}</span>
            <BBadge
              v-if="match.habitat"
              pill
              :variant="HABITAT_VARIANT[match.habitat] ?? 'secondary'"
              class="habitat-badge"
              >{{ match.habitat }}</BBadge
            >
          </span>
          <span v-if="match.sharedFavorites.length" class="housemate-reasons">
            <span
              v-for="fav in match.sharedFavorites"
              :key="fav"
              class="housemate-chip"
              :title="`${fav} is also a favorite of a current resident`"
              >✓ {{ fav }}</span
            >
          </span>
          <span v-if="match.fulfilledFavorites.length" class="housemate-reasons">
            <span
              v-for="fav in match.fulfilledFavorites"
              :key="fav"
              class="housemate-chip housemate-chip--stocked"
              :title="`${fav} is fulfilled by items already in this house's cart`"
              >{{ fav }} already stocked</span
            >
          </span>
        </button>
      </div>

      <p v-else class="text-muted fst-italic mb-2">
        No strong matches — every candidate either conflicts with the current residents or has no
        wishlist overlap with this house's items. Pick one manually below.
      </p>

      <PokemonSelect
        v-if="searchVisible"
        :pokemon-names="allPokemonNames"
        :exclude-names="excludedNames"
        :model-value="[]"
        placeholder="Add a Pokemon to this house..."
        @update:model-value="onSearchUpdate"
      />
    </template>
  </BModal>
</template>
