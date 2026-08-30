import { useDisplayModel } from '@/composables/useDisplayModel'
import { useHouseStore } from '@/stores/houses'
import { usePinStore } from '@/stores/pins'
import { usePlacementStore } from '@/stores/placements'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, ref, nextTick } from 'vue'
import type { PokemonData, SolverResult } from '@/solver'

const mockPokemonData: PokemonData = {
  Pikachu: { image: 'pikachu.png', favorites: ['Relaxation'], habitat: 'Bright' },
  Raichu: { image: 'raichu.png', favorites: ['Toy'], habitat: 'Warm' },
  Eevee: { image: 'eevee.png', favorites: ['Decoration'], habitat: 'Cool' },
}

function makeHost(overrides: {
  result?: SolverResult | null
  selectedPokemon?: string[]
  pokemonData?: PokemonData
  autoSort?: boolean
}) {
  return defineComponent({
    setup() {
      const result = ref<SolverResult | null>(overrides.result ?? null)
      const selectedPokemon = ref<string[]>(overrides.selectedPokemon ?? ['Pikachu', 'Raichu'])
      const pokemonDataRef = ref<PokemonData>(overrides.pokemonData ?? mockPokemonData)
      const autoSort = ref(overrides.autoSort ?? true)

      const api = useDisplayModel({
        result,
        selectedPokemon,
        pokemonData: pokemonDataRef,
        autoSort,
      })
      return { api, result, selectedPokemon, pokemonData: pokemonDataRef, autoSort }
    },
    template: '<div />',
  })
}

describe('useDisplayModel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('ON mode: passes through solver result houses and unhoused', async () => {
    const houseStore = useHouseStore()
    houseStore.reconcileHouses({ small: 1, medium: 0, large: 0 }, new Set())

    const result: SolverResult = {
      houses: [{ houseId: 'S1', size: 'small', capacity: 1, pokemon: ['Pikachu'] }],
      unhoused: ['Raichu'],
    }

    const Host = makeHost({ result, autoSort: true })
    const wrapper = mount(Host)

    await nextTick()

    expect(wrapper.vm.api.displayedHouses.value).toEqual(result.houses)
    expect(wrapper.vm.api.displayedUnhoused.value).toEqual(['Raichu'])
    expect(wrapper.vm.api.showResults.value).toBe(true)
  })

  it('ON mode with no result: showResults is false', async () => {
    const Host = makeHost({ result: null, autoSort: true })
    const wrapper = mount(Host)

    await nextTick()

    expect(wrapper.vm.api.showResults.value).toBe(false)
    expect(wrapper.vm.api.displayedHouses.value).toEqual([])
  })

  it('OFF mode: renders registry houses with pinned assignments', async () => {
    const houseStore = useHouseStore()
    const pinStore = usePinStore()

    // Set up registry with 2 small houses
    houseStore.reconcileHouses({ small: 2, medium: 0, large: 0 }, new Set())

    // Pin Pikachu into S1
    pinStore.pinPokemon('S1', 'Pikachu')

    const result: SolverResult = {
      houses: [
        { houseId: 'S1', size: 'small', capacity: 1, pokemon: ['Raichu'] },
        { houseId: 'S2', size: 'small', capacity: 1, pokemon: [] },
      ],
      unhoused: ['Eevee'],
    }

    const Host = makeHost({
      result,
      selectedPokemon: ['Pikachu', 'Raichu', 'Eevee'],
      autoSort: false,
    })
    const wrapper = mount(Host)

    await nextTick()

    // OFF mode: displayedHouses should include the pinned pokemon
    const houses = wrapper.vm.api.displayedHouses.value
    expect(houses).toHaveLength(2)

    // S1 should have Pikachu (pinned) — pinned names take priority
    const s1 = houses.find((h) => h.houseId === 'S1')
    expect(s1?.pokemon).toContain('Pikachu')

    // showResults should be true in OFF mode (always renders)
    expect(wrapper.vm.api.showResults.value).toBe(true)
  })

  it('OFF mode: displayedUnhoused is selection minus housed', async () => {
    const houseStore = useHouseStore()
    const pinStore = usePinStore()

    houseStore.reconcileHouses({ small: 1, medium: 0, large: 0 }, new Set())
    pinStore.pinPokemon('S1', 'Pikachu')

    const Host = makeHost({
      result: null,
      selectedPokemon: ['Pikachu', 'Raichu', 'Eevee'],
      autoSort: false,
    })
    const wrapper = mount(Host)

    await nextTick()

    // Pikachu is housed, Raichu and Eevee are not
    const unhoused = wrapper.vm.api.displayedUnhoused.value
    expect(unhoused).toContain('Raichu')
    expect(unhoused).toContain('Eevee')
    expect(unhoused).not.toContain('Pikachu')
  })

  it('OFF mode: placement overrides relocate pokemon', async () => {
    const houseStore = useHouseStore()
    const pinStore = usePinStore()
    const placementStore = usePlacementStore()

    // 2 small houses, Pikachu pinned to S1
    houseStore.reconcileHouses({ small: 2, medium: 0, large: 0 }, new Set())
    pinStore.pinPokemon('S1', 'Pikachu')

    // Drag Pikachu to S2 (override)
    placementStore.set('Pikachu', 'S2')

    const Host = makeHost({
      result: null,
      selectedPokemon: ['Pikachu'],
      autoSort: false,
    })
    const wrapper = mount(Host)

    await nextTick()

    const houses = wrapper.vm.api.displayedHouses.value
    const s1 = houses.find((h) => h.houseId === 'S1')
    const s2 = houses.find((h) => h.houseId === 'S2')

    // Pikachu should be in S2, not S1
    expect(s1?.pokemon).not.toContain('Pikachu')
    expect(s2?.pokemon).toContain('Pikachu')
  })

  it('resultsSafeToRender: false when a house references an unhydrated pokemon', async () => {
    const houseStore = useHouseStore()
    const pinStore = usePinStore()

    houseStore.reconcileHouses({ small: 1, medium: 0, large: 0 }, new Set())

    // Pin a pokemon that is NOT in pokemonData
    pinStore.pinPokemon('S1', 'MissingNo')

    const Host = makeHost({
      result: null,
      selectedPokemon: ['MissingNo', 'Pikachu'],
      autoSort: false,
    })
    const wrapper = mount(Host)

    await nextTick()

    // MissingNo is not hydrated → resultsSafeToRender should be false
    expect(wrapper.vm.api.resultsSafeToRender.value).toBe(false)
  })

  it('resultsSafeToRender: true when all pokemon are hydrated', async () => {
    const houseStore = useHouseStore()
    const pinStore = usePinStore()

    houseStore.reconcileHouses({ small: 1, medium: 0, large: 0 }, new Set())
    pinStore.pinPokemon('S1', 'Pikachu')

    const Host = makeHost({
      result: null,
      selectedPokemon: ['Pikachu', 'Eevee'],
      autoSort: false,
    })
    const wrapper = mount(Host)

    await nextTick()

    // All pokemon hydrated → should be safe
    expect(wrapper.vm.api.resultsSafeToRender.value).toBe(true)
  })

  it('islandPokemonSet: matches selectedPokemon', async () => {
    const Host = makeHost({
      result: null,
      selectedPokemon: ['Pikachu', 'Raichu'],
      autoSort: true,
    })
    const wrapper = mount(Host)

    await nextTick()

    const set = wrapper.vm.api.islandPokemonSet.value
    expect(set.has('Pikachu')).toBe(true)
    expect(set.has('Raichu')).toBe(true)
    expect(set.has('Eevee')).toBe(false)
  })

  it('sortedHouses: pinned houses sort to the bottom', async () => {
    const houseStore = useHouseStore()
    const pinStore = usePinStore()

    // 3 small houses
    houseStore.reconcileHouses({ small: 3, medium: 0, large: 0 }, new Set())

    // Pin S2
    pinStore.pinHouse('S2', [])

    const result: SolverResult = {
      houses: [
        { houseId: 'S1', size: 'small', capacity: 1, pokemon: ['Pikachu'] },
        { houseId: 'S2', size: 'small', capacity: 1, pokemon: ['Raichu'] },
        { houseId: 'S3', size: 'small', capacity: 1, pokemon: ['Eevee'] },
      ],
      unhoused: [],
    }

    const Host = makeHost({ result, autoSort: true })
    const wrapper = mount(Host)

    await nextTick()

    const sorted = wrapper.vm.api.sortedHouses.value
    // S2 (pinned) should be last
    expect(sorted[sorted.length - 1]!.houseId).toBe('S2')
  })

  it('displayedHouseOccupants: aggregates pokemon from all houses', async () => {
    const result: SolverResult = {
      houses: [
        { houseId: 'S1', size: 'small', capacity: 1, pokemon: ['Pikachu'] },
        { houseId: 'S2', size: 'small', capacity: 1, pokemon: ['Raichu'] },
      ],
      unhoused: ['Eevee'],
    }

    const Host = makeHost({ result, autoSort: true })
    const wrapper = mount(Host)

    await nextTick()

    const occupants = wrapper.vm.api.displayedHouseOccupants.value
    expect(occupants.has('Pikachu')).toBe(true)
    expect(occupants.has('Raichu')).toBe(true)
    expect(occupants.has('Eevee')).toBe(false)
  })
})
