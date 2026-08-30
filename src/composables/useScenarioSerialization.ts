import { type SharedState } from '@/composables/useSavedQueries'
import { useCartStore } from '@/stores/cart'
import { useHouseStore } from '@/stores/houses'
import { usePinStore } from '@/stores/pins'
import { usePlacementStore } from '@/stores/placements'
import { useProgressStore } from '@/stores/progress'
import type { Ref } from 'vue'

interface UseScenarioSerializationOptions {
  small: Ref<number>
  medium: Ref<number>
  large: Ref<number>
  selectedPokemon: Ref<string[]>
  autoSort: Ref<boolean>
  hydratePokemonSelection: (names: string[]) => Promise<void>
}

export function useScenarioSerialization({
  small,
  medium,
  large,
  selectedPokemon,
  autoSort,
  hydratePokemonSelection,
}: UseScenarioSerializationOptions) {
  const cartStore = useCartStore()
  const houseStore = useHouseStore()
  const pinStore = usePinStore()
  const placementStore = usePlacementStore()
  const progressStore = useProgressStore()

  async function restoreState(query: SharedState) {
    autoSort.value = query.autoSort ?? true
    // Placement overrides are never serialized: any restore drops them.
    placementStore.clear()
    small.value = query.small
    medium.value = query.medium
    large.value = query.large
    selectedPokemon.value = [...query.pokemon]
    await hydratePokemonSelection(query.pokemon)

    // Restore house registry if available (version 2+)
    if (query.houseRegistry) {
      houseStore.restoreRegistry(query)
    } else {
      // Legacy: create fresh house IDs
      houseStore.clear()
      houseStore.reconcileHouses(
        { small: query.small, medium: query.medium, large: query.large },
        new Set(),
      )
    }

    // Restore pins if available (version 2+)
    if (query.pinnedHouses || query.pinnedPokemon) {
      pinStore.restorePins(query)
    } else {
      pinStore.clear()
    }

    await cartStore.restoreItems(query.cart ?? [])
    progressStore.restoreProgress(query)
  }

  function encodeState(): string {
    const state: SharedState = {
      version: 2,
      small: small.value,
      medium: medium.value,
      large: large.value,
      pokemon: [...selectedPokemon.value],
      autoSort: autoSort.value,
      cart: cartStore.serializedCart,
      ...progressStore.toSerializable(),
      ...pinStore.toSerializable(),
      ...houseStore.toSerializable(),
    }
    return btoa(JSON.stringify(state))
  }

  return { restoreState, encodeState }
}
