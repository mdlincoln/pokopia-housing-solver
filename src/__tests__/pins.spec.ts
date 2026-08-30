import { usePinStore } from '@/stores/pins'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

describe('pin store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('pinPokemon adds the house:pokemon key additively and idempotently', () => {
    const pinStore = usePinStore()
    pinStore.pinPokemon('L1', 'Pikachu')
    expect(pinStore.isPokemonPinned('L1', 'Pikachu')).toBe(true)
    expect(pinStore.pinnedPokemon.has('L1:Pikachu')).toBe(true)

    // Idempotent: a second add changes nothing (unlike togglePokemonPin,
    // a plain pin can never silently unpin an already-locked pokemon).
    pinStore.pinPokemon('L1', 'Pikachu')
    expect(pinStore.isPokemonPinned('L1', 'Pikachu')).toBe(true)
    expect(pinStore.pinnedPokemon.size).toBe(1)

    // The pinned pokemon marks its house as effectively pinned and lands in
    // the solver's pinnedAssignments map.
    expect(pinStore.effectivelyPinnedHouseIds.has('L1')).toBe(true)
    expect(pinStore.getPinnedAssignments().get('L1')).toEqual(['Pikachu'])
  })

  it('togglePokemonPin delegates to pinPokemon when adding', () => {
    const pinStore = usePinStore()
    pinStore.togglePokemonPin('M1', 'Abra')
    expect(pinStore.isPokemonPinned('M1', 'Abra')).toBe(true)
    pinStore.togglePokemonPin('M1', 'Abra')
    expect(pinStore.isPokemonPinned('M1', 'Abra')).toBe(false)
  })
})
