import { type SharedState } from '@/composables/useSavedQueries'
import { upgradeSharedState, type RestoreResult } from '@/entityUpgrade'
import { buildEntityResolvers } from '@/queries'
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

  // Single restore choke point shared by both entry paths (URL hash and
  // saved islands). Every entity name in the incoming state is upgraded to
  // its canonical name via the tombstone layer before the stores consume it;
  // names that resolve to neither a live entity nor a tombstone are dropped
  // from the restored island and reported via the returned unmapped list.
  async function restoreState(query: SharedState): Promise<RestoreResult> {
    const { state, unmapped, upgraded } = upgradeSharedState(query, await buildEntityResolvers())
    autoSort.value = state.autoSort ?? true
    // Placement overrides are never serialized: any restore drops them.
    placementStore.clear()
    small.value = state.small
    medium.value = state.medium
    large.value = state.large
    selectedPokemon.value = [...state.pokemon]
    await hydratePokemonSelection(state.pokemon)

    // Restore house registry if available (version 2+)
    if (state.houseRegistry) {
      houseStore.restoreRegistry(state)
    } else {
      // Legacy: create fresh house IDs
      houseStore.clear()
      houseStore.reconcileHouses(
        { small: state.small, medium: state.medium, large: state.large },
        new Set(),
      )
    }

    // Restore pins if available (version 2+)
    if (state.pinnedHouses || state.pinnedPokemon) {
      pinStore.restorePins(state)
    } else {
      pinStore.clear()
    }

    await cartStore.restoreItems(state.cart ?? [])
    progressStore.restoreProgress(state)
    return { state, unmapped, upgraded }
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
