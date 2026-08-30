import { useScenarioSerialization } from '@/composables/useScenarioSerialization'
import { type SharedState } from '@/composables/useSavedQueries'
import { useCartStore } from '@/stores/cart'
import { useHouseStore } from '@/stores/houses'
import { usePinStore } from '@/stores/pins'
import { usePlacementStore } from '@/stores/placements'
import { useProgressStore } from '@/stores/progress'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref, nextTick } from 'vue'

vi.mock('@/queries', () => ({
  loadPokemonNames: vi.fn<() => Promise<string[]>>().mockResolvedValue(['Pikachu', 'Raichu']),
  loadAdjacencyMap: vi
    .fn<() => Promise<{ names: string[]; indexByName: Record<string, number>; size: number }>>()
    .mockResolvedValue({
      names: ['Pikachu', 'Raichu'],
      indexByName: { Pikachu: 0, Raichu: 1 },
      size: 2,
    }),
  loadItemGraph: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  loadPokemonData: vi
    .fn<() => Promise<Record<string, { image: string; favorites: string[]; habitat?: string }>>>()
    .mockResolvedValue({
      Pikachu: { image: 'pikachu.png', favorites: ['Relaxation'], habitat: 'Bright' },
      Raichu: { image: 'raichu.png', favorites: ['Toy'], habitat: 'Warm' },
    }),
  getAggregatedIngredients: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  favoritesForItem: vi.fn<() => unknown[]>().mockReturnValue([]),
  recommendedItemsForHouse: vi.fn<() => unknown[]>().mockReturnValue([]),
  recommendedItemsForHouseAllNeeds: vi.fn<() => unknown[]>().mockReturnValue([]),
  getItemMetadata: vi
    .fn<() => { category: string; tag: string; flavorText: string }>()
    .mockReturnValue({ category: '', tag: '', flavorText: '' }),
  getItemPicturePath: vi.fn<() => string>().mockReturnValue(''),
  getRecipeForItem: vi.fn<() => { ingredients: unknown[] }>().mockReturnValue({ ingredients: [] }),
}))

const Host = defineComponent({
  setup() {
    const small = ref(0)
    const medium = ref(0)
    const large = ref(0)
    const selectedPokemon = ref<string[]>([])
    const autoSort = ref(true)
    const hydratePokemonSelection = vi.fn<(names: string[]) => Promise<void>>(
      async (_names: string[]) => {},
    )

    const api = useScenarioSerialization({
      small,
      medium,
      large,
      selectedPokemon,
      autoSort,
      hydratePokemonSelection,
    })
    return { api, small, medium, large, selectedPokemon, autoSort, hydratePokemonSelection }
  },
  template: '<div />',
})

describe('useScenarioSerialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('restoreState restores a v2 state with houseRegistry and pins', async () => {
    const cartStore = useCartStore()
    const houseStore = useHouseStore()
    const pinStore = usePinStore()
    const progressStore = useProgressStore()

    const wrapper = mount(Host)

    const query: SharedState = {
      version: 2,
      small: 1,
      medium: 2,
      large: 1,
      pokemon: ['Pikachu', 'Raichu'],
      autoSort: false,
      cart: [],
      checkedCartItems: ['S1:Item1'],
      placedItems: ['M1:Item2'],
      pinnedHouses: ['S1'],
      pinnedPokemon: ['S1:Pikachu'],
      houseRegistry: [
        { id: 'S1', size: 'small' },
        { id: 'M1', size: 'medium' },
        { id: 'M2', size: 'medium' },
        { id: 'L1', size: 'large' },
      ],
      houseCounters: { small: 1, medium: 2, large: 1 },
    }

    await wrapper.vm.api.restoreState(query)

    expect(wrapper.vm.small).toBe(1)
    expect(wrapper.vm.medium).toBe(2)
    expect(wrapper.vm.large).toBe(1)
    expect(wrapper.vm.autoSort).toBe(false)
    expect(wrapper.vm.selectedPokemon).toEqual(['Pikachu', 'Raichu'])
    expect(wrapper.vm.hydratePokemonSelection).toHaveBeenCalledWith(['Pikachu', 'Raichu'])

    // House registry restored
    expect(houseStore.orderedHouses).toHaveLength(4)

    // Pins restored
    expect(pinStore.isHousePinned('S1')).toBe(true)
    expect(pinStore.isPokemonPinned('S1', 'Pikachu')).toBe(true)

    // Progress restored
    expect(progressStore.checkedCartItems.has('S1:Item1')).toBe(true)
    expect(progressStore.placedItems.has('M1:Item2')).toBe(true)

    // Cart restored (empty array → no items)
    expect(cartStore.items.size).toBe(0)
  })

  it('restoreState uses legacy path when houseRegistry is absent', async () => {
    const houseStore = useHouseStore()
    const pinStore = usePinStore()

    const wrapper = mount(Host)

    const query: SharedState = {
      version: 1,
      small: 1,
      medium: 1,
      large: 0,
      pokemon: ['Pikachu'],
    }

    await wrapper.vm.api.restoreState(query)

    // Legacy path: clear + reconcileHouses (no restoreRegistry)
    expect(houseStore.orderedHouses).toHaveLength(2) // 1 small + 1 medium

    // No pins restored
    expect(pinStore.pinnedHouses.size).toBe(0)
    expect(pinStore.pinnedPokemon.size).toBe(0)

    // autoSort defaults to true when key is missing
    expect(wrapper.vm.autoSort).toBe(true)
  })

  it('restoreState clears pins when neither pinnedHouses nor pinnedPokemon present', async () => {
    const pinStore = usePinStore()

    // Pre-seed pins to verify they get cleared
    pinStore.pinHouse('S1', ['Pikachu'])

    const wrapper = mount(Host)

    const query: SharedState = {
      version: 2,
      small: 1,
      medium: 0,
      large: 0,
      pokemon: ['Pikachu'],
      houseRegistry: [{ id: 'S1', size: 'small' }],
      houseCounters: { small: 1, medium: 0, large: 0 },
    }

    await wrapper.vm.api.restoreState(query)

    expect(pinStore.pinnedHouses.size).toBe(0)
    expect(pinStore.pinnedPokemon.size).toBe(0)
  })

  it('restoreState clears placement overrides on restore', async () => {
    const placementStore = usePlacementStore()
    placementStore.set('Pikachu', 'S1')

    const wrapper = mount(Host)

    const query: SharedState = {
      version: 2,
      small: 1,
      medium: 0,
      large: 0,
      pokemon: ['Pikachu'],
      houseRegistry: [{ id: 'S1', size: 'small' }],
      houseCounters: { small: 1, medium: 0, large: 0 },
    }

    await wrapper.vm.api.restoreState(query)

    expect(placementStore.placements.size).toBe(0)
  })

  it('encodeState produces a base64 round-trip with all fields', async () => {
    const cartStore = useCartStore()
    const houseStore = useHouseStore()
    const pinStore = usePinStore()
    const progressStore = useProgressStore()

    const wrapper = mount(Host)

    // Set up state
    wrapper.vm.small = 2
    wrapper.vm.medium = 1
    wrapper.vm.large = 3
    wrapper.vm.selectedPokemon = ['Pikachu', 'Raichu']
    wrapper.vm.autoSort = true

    // Set up registry
    houseStore.reconcileHouses({ small: 2, medium: 1, large: 3 }, new Set())
    pinStore.pinPokemon('S1', 'Pikachu')
    progressStore.restoreProgress({ checkedCartItems: ['S1:Item1'] })

    await nextTick()

    const encoded = wrapper.vm.api.encodeState()
    expect(() => atob(encoded)).not.toThrow()

    const decoded: SharedState = JSON.parse(atob(encoded))
    expect(decoded.version).toBe(2)
    expect(decoded.small).toBe(2)
    expect(decoded.medium).toBe(1)
    expect(decoded.large).toBe(3)
    expect(decoded.pokemon).toEqual(['Pikachu', 'Raichu'])
    expect(decoded.autoSort).toBe(true)
    expect(decoded.houseRegistry).toBeDefined()
    expect(decoded.houseCounters).toBeDefined()
    expect(decoded.pinnedHouses).toBeDefined()
    expect(decoded.pinnedPokemon).toBeDefined()
    expect(decoded.checkedCartItems).toContain('S1:Item1')
    expect(decoded.cart).toEqual(cartStore.serializedCart)
  })
})
