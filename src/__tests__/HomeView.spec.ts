import {
  loadAdjacencyMap,
  loadPokemonData,
  loadPokemonNames,
  loadSpawnHabitatsByName,
} from '@/queries'
import { TOUR_STORAGE_KEY } from '@/onboarding'
import type { SolverResult } from '@/solver'
import { useCartStore } from '@/stores/cart'
import { usePinStore } from '@/stores/pins'
import { usePlacementStore } from '@/stores/placements'
import { useProgressStore } from '@/stores/progress'
import HomeView from '@/views/HomeView.vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

const mockSolve =
  vi.fn<
    (
      pokemonNames: string[],
      houses: import('@/stores/houses').HouseEntry[],
      pokemonData: import('@/solver').PokemonData,
      adjacencyData?: import('@/solver').AdjacencyData,
      pinnedAssignments?: Map<string, string[]>,
    ) => Promise<SolverResult>
  >()

vi.mock('@/solver', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    solve: ((...args: unknown[]) =>
      mockSolve(...(args as Parameters<typeof mockSolve>))) as (typeof import('@/solver'))['solve'],
  }
})

vi.mock('@/queries', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    loadPokemonNames: vi.fn<() => Promise<string[]>>(),
    loadPokemonData: vi.fn<() => Promise<import('@/solver').PokemonData>>(),
    loadAdjacencyMap: vi.fn<() => Promise<import('@/solver').AdjacencyData>>(),
    loadSpawnHabitatsByName:
      vi.fn<() => Promise<Record<string, import('@/queries').SpawnHabitat[]>>>(),
  }
})

const testPokemonData = {
  AlphaOne: { image: '', favorites: ['A', 'B', 'C', 'D', 'E'], habitat: 'Dark' },
  AlphaTwo: { image: '', favorites: ['A', 'B', 'C', 'D', 'F'], habitat: 'Dark' },
  BetaOne: { image: '', favorites: ['X', 'Y', 'Z', 'W', 'V'], habitat: 'Bright' },
}

const testSpawnHabitats = {
  AlphaOne: [
    { id: 1, name: 'Tall Grass', image: 'images/habitats/1.png' },
    { id: 22, name: 'Bench with greenery', image: 'images/habitats/22.png' },
  ],
  AlphaTwo: [{ id: 1, name: 'Tall Grass', image: 'images/habitats/1.png' }],
  BetaOne: [{ id: 40, name: 'Fountain square', image: 'images/habitats/40.png' }],
}

async function mountHome() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: HomeView }],
  })
  router.push('/')
  await router.isReady()

  const wrapper = mount(HomeView, {
    global: { plugins: [router, createPinia()] },
  })
  await flushPromises()
  return wrapper
}

// Mounts without flushing, keeping the onMounted catalog-load window open so
// the catalog-loading gate can be observed mid-flight.
function mountHomeRaw() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: HomeView }],
  })
  router.push('/')
  return mount(HomeView, {
    global: { plugins: [router, createPinia()] },
  })
}

describe('HomeView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    vi.mocked(loadPokemonNames).mockResolvedValue(Object.keys(testPokemonData).sort())
    vi.mocked(loadPokemonData).mockImplementation(async (names?: string[]) => {
      if (!names) {
        return testPokemonData
      }
      return Object.fromEntries(
        names
          .map((name) => [name, testPokemonData[name as keyof typeof testPokemonData]])
          .filter(([, value]) => !!value),
      )
    })
    vi.mocked(loadAdjacencyMap).mockResolvedValue({
      names: [],
      indexByName: new Map(),
      size: 0,
      matrix: new Int16Array(0),
    })
    vi.mocked(loadSpawnHabitatsByName).mockImplementation(async (names?: string[]) => {
      if (!names) return testSpawnHabitats
      return Object.fromEntries(
        names
          .map((name) => [name, testSpawnHabitats[name as keyof typeof testSpawnHabitats]])
          .filter(([, value]) => !!value),
      )
    })
    window.location.hash = ''
    // Model a returning visitor: the guided tour's auto-start (an e2e-level
    // behavior) would otherwise load a sample island and hydrate attributes on
    // mount, which several of these mount asserts below do not expect.
    localStorage.setItem(TOUR_STORAGE_KEY, '1')
  })

  it('renders the form with house inputs and submit button', async () => {
    const wrapper = await mountHome()

    const spinbuttons = wrapper.findAll('[role="spinbutton"]')
    expect(spinbuttons).toHaveLength(3)

    expect(wrapper.find('[data-testid="results"]').exists()).toBe(false)
  })

  it('loads pokemon names and adjacency data on mount without hydrating attributes', async () => {
    await mountHome()

    expect(loadPokemonNames).toHaveBeenCalledOnce()
    expect(loadPokemonData).not.toHaveBeenCalled()
    expect(loadAdjacencyMap).toHaveBeenCalledOnce()
  })

  it('shows a catalog-loading gate while the initial catalog loads, then reveals the config UI', async () => {
    let resolveNames!: (names: string[]) => void
    vi.mocked(loadPokemonNames).mockReturnValue(
      new Promise((res) => {
        resolveNames = res
      }),
    )

    const wrapper = mountHomeRaw()
    await nextTick()

    expect(wrapper.find('[data-testid="catalog-loading"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Loading catalog…')
    expect(wrapper.find('[role="spinbutton"]').exists()).toBe(false)

    resolveNames(Object.keys(testPokemonData).sort())
    await flushPromises()

    expect(wrapper.find('[data-testid="catalog-loading"]').exists()).toBe(false)
    expect(wrapper.findAll('[role="spinbutton"]')).toHaveLength(3)
  })

  it('keeps the catalog-loading gate up while restoring a query from the URL hash', async () => {
    const shared = { small: 1, medium: 0, large: 0, pokemon: ['AlphaOne'] }
    window.location.hash = `#${btoa(JSON.stringify(shared))}`

    let resolveHydrate!: (data: import('@/solver').PokemonData) => void
    vi.mocked(loadPokemonData).mockReturnValue(
      new Promise((res) => {
        resolveHydrate = res
      }),
    )

    const wrapper = mountHomeRaw()
    await nextTick()

    // Names/adjacency resolve immediately but the hash restore is still
    // waiting on pokemon hydration, so the gate must remain visible.
    expect(wrapper.find('[data-testid="catalog-loading"]').exists()).toBe(true)

    resolveHydrate({ AlphaOne: testPokemonData.AlphaOne })
    await flushPromises()

    expect(wrapper.find('[data-testid="catalog-loading"]').exists()).toBe(false)
    expect(wrapper.findAll('[role="spinbutton"]')).toHaveLength(3)
    expect(wrapper.vm.selectedPokemon).toEqual(['AlphaOne'])
  })

  it('shows a restoring indicator while a saved query restores from localStorage', async () => {
    const entry = {
      title: 'Slow restore',
      timestamp: 1700000000123,
      small: 1,
      medium: 0,
      large: 0,
      pokemon: ['AlphaOne'],
    }
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify([entry]))

    const wrapper = await mountHome()
    const cartStore = useCartStore()
    vi.spyOn(cartStore, 'restoreItems').mockResolvedValue(undefined)

    let resolveHydrate!: (data: import('@/solver').PokemonData) => void
    vi.mocked(loadPokemonData).mockReturnValue(
      new Promise((res) => {
        resolveHydrate = res
      }),
    )

    wrapper.vm.selectedTimestamp = entry.timestamp
    await flushPromises()

    expect(wrapper.find('[data-testid="catalog-loading"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Restoring saved island…')

    resolveHydrate({ AlphaOne: testPokemonData.AlphaOne })
    await flushPromises()

    expect(wrapper.find('[data-testid="catalog-loading"]').exists()).toBe(false)
    expect(wrapper.findAll('[role="spinbutton"]')).toHaveLength(3)
  })

  it('hydrates pokemon data when names are selected', async () => {
    const wrapper = await mountHome()

    wrapper.vm.selectedPokemon = ['AlphaOne', 'AlphaTwo']
    await flushPromises()

    expect(loadPokemonData).toHaveBeenCalledExactlyOnceWith(['AlphaOne', 'AlphaTwo'])
  })

  it('removes pokemon from in-memory data without a new query', async () => {
    const wrapper = await mountHome()

    wrapper.vm.selectedPokemon = ['AlphaOne', 'AlphaTwo']
    await flushPromises()
    expect(loadPokemonData).toHaveBeenCalledTimes(1)

    wrapper.vm.selectedPokemon = ['AlphaOne']
    await flushPromises()

    expect(loadPokemonData).toHaveBeenCalledTimes(1)
  })

  it('hydrates spawnHabitatsByName when pokemon are selected and prunes on deselect', async () => {
    const wrapper = await mountHome()

    wrapper.vm.selectedPokemon = ['AlphaOne', 'AlphaTwo']
    await flushPromises()

    expect(loadSpawnHabitatsByName).toHaveBeenCalledExactlyOnceWith(['AlphaOne', 'AlphaTwo'])
    expect(wrapper.vm.spawnHabitatsByName).toEqual({
      AlphaOne: testSpawnHabitats.AlphaOne,
      AlphaTwo: testSpawnHabitats.AlphaTwo,
    })

    // Deselecting prunes the deselected name's habitats.
    wrapper.vm.selectedPokemon = ['AlphaOne']
    await flushPromises()

    expect(wrapper.vm.spawnHabitatsByName).toEqual({
      AlphaOne: testSpawnHabitats.AlphaOne,
    })

    // Re-selecting merges without clobbering the survivor's entry.
    wrapper.vm.selectedPokemon = ['AlphaOne', 'BetaOne']
    await flushPromises()

    expect(wrapper.vm.spawnHabitatsByName).toEqual({
      AlphaOne: testSpawnHabitats.AlphaOne,
      BetaOne: testSpawnHabitats.BetaOne,
    })
  })

  it('a pinned pokemon deselected from the search keeps its spawnHabitatsByName entry', async () => {
    const wrapper = await mountHome()
    const pinStore = usePinStore()

    wrapper.vm.selectedPokemon = ['AlphaOne', 'AlphaTwo']
    await flushPromises()
    expect(wrapper.vm.spawnHabitatsByName).toEqual({
      AlphaOne: testSpawnHabitats.AlphaOne,
      AlphaTwo: testSpawnHabitats.AlphaTwo,
    })

    // Pin AlphaTwo to a house, then remove it from the selection: it stays
    // rendered in its house via the pin, so its thumbnails must survive —
    // mirroring prunePokemonData's pinned-pokemon preservation.
    pinStore.togglePokemonPin('M1', 'AlphaTwo')

    wrapper.vm.selectedPokemon = ['AlphaOne']
    await flushPromises()

    expect(wrapper.vm.spawnHabitatsByName).toEqual({
      AlphaOne: testSpawnHabitats.AlphaOne,
      AlphaTwo: testSpawnHabitats.AlphaTwo,
    })
  })

  it('clearPokemon resets spawnHabitatsByName', async () => {
    const wrapper = await mountHome()

    wrapper.vm.selectedPokemon = ['AlphaOne']
    await flushPromises()
    expect(Object.keys(wrapper.vm.spawnHabitatsByName)).toEqual(['AlphaOne'])

    // Clearing the pokemon selection (the "Clear all" button) empties the map.
    wrapper.vm.selectedPokemon = []
    await flushPromises()

    expect(wrapper.vm.spawnHabitatsByName).toEqual({})
  })

  it('displays results with all pokemon housed', async () => {
    const solverResult: SolverResult = {
      houses: [
        { houseId: 'S1', size: 'medium', capacity: 2, pokemon: ['AlphaOne', 'AlphaTwo'] },
        { houseId: 'M1', size: 'small', capacity: 1, pokemon: ['BetaOne'] },
      ],
      unhoused: [],
    }
    mockSolve.mockResolvedValueOnce(solverResult)

    const wrapper = await mountHome()
    // Directly set the reactive data to trigger the solver
    wrapper.vm.medium = 1
    wrapper.vm.small = 1
    wrapper.vm.selectedPokemon = ['AlphaOne', 'AlphaTwo', 'BetaOne']
    await flushPromises()

    const cards = wrapper.findAll('[data-testid="house-card"]')
    expect(cards).toHaveLength(2)

    expect(cards[0]!.text()).toContain('AlphaOne')
    expect(cards[0]!.text()).toContain('AlphaTwo')
    expect(cards[1]!.text()).toContain('BetaOne')

    expect(wrapper.find('[data-testid="unhoused"]').exists()).toBe(false)
  })

  it('displays unhoused pokemon section', async () => {
    const solverResult: SolverResult = {
      houses: [{ houseId: 'S1', size: 'small', capacity: 1, pokemon: ['AlphaOne'] }],
      unhoused: ['AlphaTwo', 'BetaOne'],
    }
    mockSolve.mockResolvedValueOnce(solverResult)

    const wrapper = await mountHome()
    wrapper.vm.small = 1
    wrapper.vm.selectedPokemon = ['AlphaOne', 'AlphaTwo', 'BetaOne']
    await flushPromises()

    const unhoused = wrapper.find('[data-testid="unhoused"]')
    expect(unhoused.exists()).toBe(true)
    expect(unhoused.text()).toContain('AlphaTwo')
    expect(unhoused.text()).toContain('BetaOne')
  })

  it('displays the unhoused warning when pokemon are present with zero houses', async () => {
    const solverResult: SolverResult = {
      houses: [],
      unhoused: ['AlphaOne', 'AlphaTwo'],
    }
    mockSolve.mockResolvedValueOnce(solverResult)

    const wrapper = await mountHome()
    wrapper.vm.selectedPokemon = ['AlphaOne', 'AlphaTwo']
    await flushPromises()

    const unhoused = wrapper.find('[data-testid="unhoused"]')
    expect(unhoused.exists()).toBe(true)
    expect(unhoused.text()).toContain('AlphaOne')
    expect(unhoused.text()).toContain('AlphaTwo')
    // Outline: h2 Results → h3 alert heading (no skipped levels)
    expect(unhoused.find('h3.alert-heading').text()).toBe('Not enough housing')
  })

  it('displays empty houses', async () => {
    const solverResult: SolverResult = {
      houses: [
        { houseId: 'S1', size: 'large', capacity: 4, pokemon: ['AlphaOne'] },
        { houseId: 'M1', size: 'small', capacity: 1, pokemon: [] },
      ],
      unhoused: [],
    }
    mockSolve.mockResolvedValueOnce(solverResult)

    const wrapper = await mountHome()
    wrapper.vm.large = 1
    wrapper.vm.small = 1
    wrapper.vm.selectedPokemon = ['AlphaOne']
    await flushPromises()

    const cards = wrapper.findAll('[data-testid="house-card"]')
    expect(cards).toHaveLength(2)
    // A totally empty house (no pokemon, no cart items) renders the inline
    // pokemon search instead of the old "Empty" placeholder.
    const emptyCard = cards[1]!
    expect(emptyCard.find('[data-testid="empty"]').exists()).toBe(false)
    expect(emptyCard.find('[data-testid="house-empty-input"]').exists()).toBe(true)
  })

  it('addPokemonToHouse pins the newcomer to the house and adds it to the selection', async () => {
    const solverResult: SolverResult = {
      houses: [{ houseId: 'L1', size: 'large', capacity: 4, pokemon: ['AlphaOne', 'BetaOne'] }],
      unhoused: [],
    }
    mockSolve.mockResolvedValue(solverResult)

    const wrapper = await mountHome()
    const pinStore = usePinStore()
    wrapper.vm.large = 1
    wrapper.vm.selectedPokemon = ['AlphaOne']
    await flushPromises()

    wrapper.vm.addPokemonToHouse({ houseId: 'L1', name: 'BetaOne' })
    await flushPromises()

    // Pin BEFORE selection means the re-solve saw BetaOne as a pinned
    // assignment of L1 (jsdom falls back to the synchronous mocked solve).
    expect(pinStore.isPokemonPinned('L1', 'BetaOne')).toBe(true)
    expect(wrapper.vm.selectedPokemon).toContain('BetaOne')
    const lastCall = mockSolve.mock.calls[mockSolve.mock.calls.length - 1]!
    const pinnedAssignments = lastCall[4] as Map<string, string[]>
    expect(pinnedAssignments).toBeInstanceOf(Map)
    expect(pinnedAssignments.get('L1')).toContain('BetaOne')

    // Duplicate adds are a no-op (selection UIs exclude island residents, but
    // the handler guards anyway).
    const selectedCount = wrapper.vm.selectedPokemon.length
    wrapper.vm.addPokemonToHouse({ houseId: 'L1', name: 'BetaOne' })
    await flushPromises()
    expect(wrapper.vm.selectedPokemon).toHaveLength(selectedCount)
  })

  it('displays error when solver fails', async () => {
    mockSolve.mockRejectedValueOnce(new Error('Solver exploded'))

    const wrapper = await mountHome()
    wrapper.vm.small = 1
    wrapper.vm.selectedPokemon = ['AlphaOne']
    await flushPromises()

    const errorEl = wrapper.find('[data-testid="error"]')
    expect(errorEl.exists()).toBe(true)
    expect(errorEl.text()).toContain('Solver exploded')
  })

  // @lat: [[ui#HomeView#Saved Queries#Saves title with query]]
  it('saves query with title to localStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const wrapper = await mountHome()
    wrapper.vm.small = 1
    wrapper.vm.selectedPokemon = ['AlphaOne']
    wrapper.vm.queryTitle = 'My favourite island'
    wrapper.vm.confirmSave()

    expect(setItem).toHaveBeenCalledWith(
      'pokehousing_saved_queries',
      expect.stringContaining('"title":"My favourite island"'),
    )
  })

  // @lat: [[ui#HomeView#Saved Queries#Saves cart items with saved query]]
  it('saves cart items with saved query', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const wrapper = await mountHome()
    const cartStore = useCartStore()
    cartStore.items.set('S1:Punching Bag', {
      houseId: 'S1',
      picturePath: null,
      isCraftable: true,
      category: 'Outdoor',
      flavorText: null,
      tag: null,
    })

    wrapper.vm.small = 1
    wrapper.vm.selectedPokemon = ['AlphaOne']
    wrapper.vm.queryTitle = 'Cart test'
    wrapper.vm.confirmSave()

    const call = setItem.mock.calls.find(([key]) => key === 'pokehousing_saved_queries')
    expect(call).toBeDefined()
    const saved = JSON.parse(call![1] as string)
    expect(saved[0].cart).toEqual([{ houseId: 'S1', name: 'Punching Bag' }])
  })

  // @lat: [[ui#HomeView#Saved Queries#Restores cart from saved query]]
  it('restores cart from saved query', async () => {
    const entry = {
      title: 'Saved with cart',
      timestamp: 1700000000000,
      small: 1,
      medium: 0,
      large: 0,
      pokemon: ['AlphaOne'],
      cart: [{ houseId: 'S1', name: 'Punching Bag', quantity: 3 }],
    }
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify([entry]))

    const wrapper = await mountHome()
    const cartStore = useCartStore()
    const restoreItemsSpy = vi.spyOn(cartStore, 'restoreItems').mockResolvedValue(undefined)

    wrapper.vm.selectedTimestamp = 1700000000000
    await flushPromises()

    expect(restoreItemsSpy).toHaveBeenCalledWith([
      { houseId: 'S1', name: 'Punching Bag', quantity: 3 },
    ])
  })

  // @lat: [[ui#HomeView#Pinning#Saves pin state with query]]
  it('saves pin state with saved query', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const wrapper = await mountHome()
    const pinStore = usePinStore()
    pinStore.pinHouse('S1', ['AlphaOne'])
    pinStore.togglePokemonPin('M1', 'AlphaTwo')

    wrapper.vm.confirmSave()

    const call = setItem.mock.calls.find(([key]) => key === 'pokehousing_saved_queries')
    expect(call).toBeDefined()
    const saved = JSON.parse(call![1] as string)
    expect(saved[0].pinnedHouses).toContain('S1')
    expect(saved[0].pinnedPokemon).toContain('S1:AlphaOne')
    expect(saved[0].pinnedPokemon).toContain('M1:AlphaTwo')
  })

  // @lat: [[ui#HomeView#Pinning#Restores pin state from query]]
  it('restores pin state from saved query', async () => {
    const entry = {
      title: 'With pins',
      timestamp: 1700000000001,
      version: 2,
      small: 1,
      medium: 0,
      large: 0,
      pokemon: ['AlphaOne'],
      pinnedHouses: ['S1'],
      pinnedPokemon: ['S1:AlphaOne'],
      houseRegistry: [{ id: 'S1', size: 'small' }],
      houseCounters: { small: 1, medium: 0, large: 0 },
    }
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify([entry]))

    const wrapper = await mountHome()
    const pinStore = usePinStore()
    const cartStore = useCartStore()
    vi.spyOn(cartStore, 'restoreItems').mockResolvedValue(undefined)

    wrapper.vm.selectedTimestamp = 1700000000001
    await flushPromises()

    expect(pinStore.isHousePinned('S1')).toBe(true)
    expect(pinStore.isPokemonPinned('S1', 'AlphaOne')).toBe(true)
    expect(pinStore.isHousePinned('S2')).toBe(false)
  })

  // @lat: [[ui#HomeView#Saved Queries#Shows title in restore dropdown]]
  it('restores query showing title in dropdown', async () => {
    const entry = {
      title: 'Jungle paradise',
      timestamp: 1700000000000,
      small: 1,
      medium: 0,
      large: 0,
      pokemon: ['AlphaOne'],
    }
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify([entry]))

    const wrapper = await mountHome()

    const select = wrapper.find('#saved-queries-select')
    expect(select.html()).toContain('Jungle paradise')
    expect(select.html()).toContain(new Date(entry.timestamp).toLocaleString())
  })

  // @lat: [[ui#HomeView#Saved Queries#Loads legacy entry without checkbox fields]]
  it('restores legacy entry without pin fields with all pins cleared', async () => {
    const legacyEntry = {
      title: 'Legacy save',
      timestamp: 1700000000010,
      small: 1,
      medium: 0,
      large: 0,
      pokemon: ['AlphaOne'],
      // no pinnedHouses, pinnedPokemon, checkedHouses, checkedPokemon
    }
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify([legacyEntry]))

    const wrapper = await mountHome()
    const pinStore = usePinStore()
    const cartStore = useCartStore()
    vi.spyOn(cartStore, 'restoreItems').mockResolvedValue(undefined)

    pinStore.pinHouse('S1', ['AlphaOne'])
    expect(pinStore.isHousePinned('S1')).toBe(true)

    wrapper.vm.selectedTimestamp = 1700000000010
    await flushPromises()

    expect(pinStore.isHousePinned('S1')).toBe(false)
    expect(pinStore.pinnedPokemon.size).toBe(0)
  })

  // @lat: [[ui#HomeView#Saved Queries#Loads legacy cart entry without houseIndex]]
  it('restores legacy cart entry without houseId by passing raw cart array to restoreItems', async () => {
    const legacyEntry = {
      title: 'Legacy cart',
      timestamp: 1700000000011,
      small: 1,
      medium: 0,
      large: 0,
      pokemon: ['AlphaOne'],
      cart: [{ name: 'Berry Pots', quantity: 3 }], // no houseId
    }
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify([legacyEntry]))

    const wrapper = await mountHome()
    const cartStore = useCartStore()
    const restoreItemsSpy = vi.spyOn(cartStore, 'restoreItems').mockResolvedValue(undefined)

    wrapper.vm.selectedTimestamp = 1700000000011
    await flushPromises()

    expect(restoreItemsSpy).toHaveBeenCalledWith([{ name: 'Berry Pots', quantity: 3 }])
  })

  // @lat: [[ui#HomeView#Saved Queries#Loads legacy cart entry with houseIndex]]
  it('restores legacy cart entry using houseIndex and quantity through full restoreState', async () => {
    const legacyEntry = {
      title: 'Legacy houseIndex cart',
      timestamp: 1700000000013,
      small: 1,
      medium: 0,
      large: 0,
      pokemon: ['AlphaOne'],
      cart: [{ houseIndex: 0, name: 'Punching Bag', quantity: 2 }], // no houseId
    }
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify([legacyEntry]))

    // Do NOT mock cartStore.restoreItems: this exercises the real restoreState →
    // restoreItems path (AC.5), including the houseId ?? String(houseIndex ?? 0)
    // fallback, against the real item graph in src/data/items.json.
    const wrapper = await mountHome()
    const cartStore = useCartStore()

    wrapper.vm.selectedTimestamp = 1700000000013
    await flushPromises()

    expect(cartStore.items.has('0:Punching Bag')).toBe(true)
    expect(cartStore.items.get('0:Punching Bag')!.houseId).toBe('0')
  })

  // @lat: [[ui#HomeView#Saved Queries#Loads legacy entry with no cart field]]
  it('restores legacy entry with no cart field by passing empty array to restoreItems', async () => {
    const legacyEntry = {
      title: '',
      timestamp: 1700000000012,
      small: 1,
      medium: 1,
      large: 0,
      pokemon: ['AlphaOne', 'AlphaTwo'],
      // no cart field
    }
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify([legacyEntry]))

    const wrapper = await mountHome()
    const cartStore = useCartStore()
    const restoreItemsSpy = vi.spyOn(cartStore, 'restoreItems').mockResolvedValue(undefined)

    wrapper.vm.selectedTimestamp = 1700000000012
    await flushPromises()

    expect(restoreItemsSpy).toHaveBeenCalledWith([])
  })

  // @lat: [[ui#ShoppingCart#Cart Store#addItem is idempotent per house]]
  it('addItem is idempotent per house', async () => {
    await mountHome()
    const cartStore = useCartStore()
    await cartStore.addItem('S1', 'Punching Bag')
    await cartStore.addItem('S1', 'Punching Bag')
    expect(cartStore.items.size).toBe(1)
  })

  // @lat: [[ui#HomeView#Saved Queries#Saves placedItems with saved query]]
  it('saves placedItems with saved query', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const wrapper = await mountHome()
    const progressStore = useProgressStore()
    progressStore.togglePlacedItem('S1', 'Apple')

    wrapper.vm.confirmSave()

    const call = setItem.mock.calls.find(([key]) => key === 'pokehousing_saved_queries')
    expect(call).toBeDefined()
    const saved = JSON.parse(call![1] as string)
    expect(saved[0].placedItems).toEqual(['S1:Apple'])
  })

  // @lat: [[ui#HomeView#Saved Queries#Tolerates corrupt localStorage]]
  it('tolerates corrupt localStorage without throwing and yields no saved queries', async () => {
    // One-shot corrupt value; subsequent getItem calls fall back to the original
    // implementation, so the corrupt mock does not leak into other tests.
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValueOnce('not-json{{')

    // Must not throw — loadSavedQueries() catches the JSON.parse error and returns [].
    const wrapper = await mountHome()

    // With no saved queries the restore dropdown group is absent (no render crash).
    expect(wrapper.find('#saved-queries-select').exists()).toBe(false)
    expect(wrapper.find('[data-testid="catalog-loading"]').exists()).toBe(false)
  })

  it('explains why pokemon are unhoused and what to do about it', async () => {
    const solverResult: SolverResult = {
      houses: [{ houseId: 'S1', size: 'small', capacity: 1, pokemon: ['AlphaOne'] }],
      unhoused: ['AlphaTwo', 'BetaOne'],
    }
    mockSolve.mockResolvedValueOnce(solverResult)

    const wrapper = await mountHome()
    wrapper.vm.small = 1
    wrapper.vm.selectedPokemon = ['AlphaOne', 'AlphaTwo', 'BetaOne']
    await flushPromises()

    const banner = wrapper.find('[data-testid="unhoused"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('Not enough housing')
    expect(banner.text()).toContain('Add houses above')
    expect(banner.findAll('[data-testid="pokemon-card"]')).toHaveLength(2)
  })

  it('uses island vocabulary for the save/restore UI', async () => {
    const entry = {
      title: 'Vocab',
      timestamp: 1700000000021,
      small: 1,
      medium: 0,
      large: 0,
      pokemon: ['AlphaOne'],
    }
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify([entry]))

    const wrapper = await mountHome()

    const saveButton = wrapper.findAll('button').find((b) => b.text() === 'Save current island')
    expect(saveButton).toBeDefined()
    expect(wrapper.find('[data-testid="saved-queries-manage"]').exists()).toBe(true)
    const select = wrapper.find('#saved-queries-select')
    expect(select.html()).toContain('Select a saved island…')
    // The storage notice is sentence-case muted text in the card footer.
    const notice = wrapper.find('.card-footer')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toBe('Saved to this browser only — nothing leaves your computer.')
  })

  // @lat: [[ui#HomeView#Saved Queries#Deletes saved island with undo]]
  it('deletes a saved island and undo re-inserts it at the original index', async () => {
    const older = {
      title: 'First',
      timestamp: 1700000000022,
      small: 1,
      medium: 0,
      large: 0,
      pokemon: ['AlphaOne'],
    }
    const newer = {
      title: 'Second',
      timestamp: 1700000000023,
      small: 1,
      medium: 0,
      large: 0,
      pokemon: ['AlphaTwo'],
    }
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify([newer, older]))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const wrapper = await mountHome()
    wrapper.vm.deleteSaved(older.timestamp)
    await nextTick()

    expect(wrapper.vm.savedQueries.map((q) => q.timestamp)).toEqual([newer.timestamp])
    const deletedAlert = wrapper.find('[data-testid="saved-query-deleted"]')
    expect(deletedAlert.exists()).toBe(true)
    expect(deletedAlert.text()).toContain('First')

    const writes = () => setItem.mock.calls.filter(([key]) => key === 'pokehousing_saved_queries')

    let lastWrite = writes()[writes().length - 1]![1] as string
    expect(JSON.parse(lastWrite).map((q: { timestamp: number }) => q.timestamp)).toEqual([
      newer.timestamp,
    ])

    wrapper.vm.undoDelete()
    await nextTick()

    expect(wrapper.vm.savedQueries.map((q) => q.timestamp)).toEqual([
      newer.timestamp,
      older.timestamp,
    ])
    expect(wrapper.find('[data-testid="saved-query-deleted"]').exists()).toBe(false)

    lastWrite = writes()[writes().length - 1]![1] as string
    expect(JSON.parse(lastWrite).map((q: { timestamp: number }) => q.timestamp)).toEqual([
      newer.timestamp,
      older.timestamp,
    ])
  })

  it('hides the saved-islands select when the last entry is deleted', async () => {
    const entry = {
      title: 'Last one',
      timestamp: 1700000000024,
      small: 1,
      medium: 0,
      large: 0,
      pokemon: ['AlphaOne'],
    }
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify([entry]))

    const wrapper = await mountHome()
    expect(wrapper.find('#saved-queries-select').exists()).toBe(true)

    wrapper.vm.deleteSaved(entry.timestamp)
    await nextTick()

    expect(wrapper.find('#saved-queries-select').exists()).toBe(false)
    expect(wrapper.find('[data-testid="saved-queries-manage"]').exists()).toBe(false)
  })

  it('closes the undo window after 8 seconds', async () => {
    const entry = {
      title: 'Expiring',
      timestamp: 1700000000025,
      small: 1,
      medium: 0,
      large: 0,
      pokemon: ['AlphaOne'],
    }
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify([entry]))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const wrapper = await mountHome()
    vi.useFakeTimers()
    try {
      wrapper.vm.deleteSaved(entry.timestamp)
      await nextTick()
      expect(wrapper.find('[data-testid="saved-query-deleted"]').exists()).toBe(true)

      await vi.advanceTimersByTimeAsync(8000)

      expect(wrapper.find('[data-testid="saved-query-deleted"]').exists()).toBe(false)
      expect(wrapper.vm.savedQueries).toEqual([])
      // The deletion was persisted at delete time; the lapsed undo window is
      // only about the on-screen affordance.
      const lastWrites = setItem.mock.calls.filter(([key]) => key === 'pokehousing_saved_queries')
      const lastWrite = lastWrites[lastWrites.length - 1]![1] as string
      expect(JSON.parse(lastWrite)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  // @lat: [[ui#HomeView#Saved Queries#Save modal submits on Enter]]
  it('pressing Enter in the save modal saves exactly once and closes the modal', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('[]')

    const wrapper = await mountHome()
    wrapper.vm.queryTitle = 'Enter save'
    wrapper.vm.showSaveModal = true
    wrapper.vm.onSaveEnter()
    await nextTick()

    expect(wrapper.vm.savedQueries).toHaveLength(1)
    expect(wrapper.vm.savedQueries[0]).toMatchObject({ title: 'Enter save' })
    expect(wrapper.vm.showSaveModal).toBe(false)
  })

  it('renders the four config-card titles as h2 (h1 hero → h2 section titles)', async () => {
    const wrapper = await mountHome()

    const h2Texts = wrapper.findAll('h2.section-heading').map((h2) => h2.text())
    expect(h2Texts).toContain('Automatically sort Pokemon')
    expect(h2Texts).toContain('Houses')
    expect(h2Texts).toContain('Pokémon')
    expect(h2Texts).toContain('Saved islands')
    // No h5 headings remain anywhere in the outline (previously card titles).
    expect(wrapper.findAll('h5')).toHaveLength(0)
  })

  it('renders both modal titles as h2', async () => {
    const wrapper = await mountHome()
    wrapper.vm.showSaveModal = true
    await flushPromises()
    // BModal teleports to document.body outside the wrapper element.
    expect(document.querySelector('.modal-title')?.tagName).toBe('H2')

    wrapper.vm.showSaveModal = false
    wrapper.vm.showManageModal = true
    await flushPromises()
    const titles = [...document.querySelectorAll('.modal-title')]
    expect(titles.every((t) => t.tagName === 'H2')).toBe(true)

    wrapper.vm.showManageModal = false
    await flushPromises()
  })

  describe('autoSort toggle', () => {
    it('is ON by default on a fresh load', async () => {
      const wrapper = await mountHome()
      expect(wrapper.vm.autoSort).toBe(true)
      const card = wrapper.find('[data-testid="autosort-card"]')
      expect(card.exists()).toBe(true)
      const switchInput = card.find('[data-testid="autosort-switch"]')
      expect(switchInput.attributes('aria-label')).toBe('Automatically sort Pokemon')
      expect((switchInput.element as HTMLInputElement).checked).toBe(true)
    })

    // AC.3 — while OFF, mutating selection/houses/pins dispatches no solve.
    it('dispatches no solve while off when selection, counts, or pins change', async () => {
      const wrapper = await mountHome()
      const pinStore = usePinStore()

      wrapper.vm.autoSort = false
      wrapper.vm.small = 2
      wrapper.vm.medium = 1
      wrapper.vm.selectedPokemon = ['AlphaOne', 'AlphaTwo']
      await flushPromises()
      pinStore.pinHouse('S1', ['AlphaOne'])
      await flushPromises()

      expect(mockSolve).not.toHaveBeenCalled()
      expect(wrapper.vm.solving).toBe(false)
      // Pinning S1 moves AlphaOne into that house card (pinned overlay), so it
      // leaves the warning; the unpinned house + AlphaTwo stay unassigned.
      const results = wrapper.find('[data-testid="results"]')
      expect(results.text()).toContain('AlphaOne')
      const unhoused = wrapper.find('[data-testid="unhoused"]')
      expect(unhoused.exists()).toBe(true)
      expect(unhoused.text()).toContain('AlphaTwo')
      expect(unhoused.text()).not.toContain('AlphaOne')
    })

    // AC.5 — with OFF and no prior solve, registry-derived houses still render.
    it('renders registry-derived houses while off before any solve runs', async () => {
      const wrapper = await mountHome()

      wrapper.vm.autoSort = false
      wrapper.vm.small = 2
      wrapper.vm.medium = 1
      await flushPromises()

      const cards = wrapper.findAll('[data-testid="house-card"]')
      expect(cards).toHaveLength(3)
      // Totally empty houses render the inline input, and partially-empty
      // bookkeeping is simply absent (no slots without occupants/cart items).
      expect(wrapper.findAll('[data-testid="house-empty-input"]')).toHaveLength(3)
      expect(mockSolve).not.toHaveBeenCalled()
    })

    // AC.4 — add-while-off pins and selects the pokemon AND shows it in its
    // target house immediately (pinned placements overlay the OFF view); no
    // solve runs. A pokemon not pinned to a house still lands in the warning.
    it('shows a pokemon added to a house in that house while off, no solve', async () => {
      const wrapper = await mountHome()
      const pinStore = usePinStore()

      wrapper.vm.autoSort = false
      wrapper.vm.medium = 1
      await flushPromises()

      wrapper.vm.addPokemonToHouse({ houseId: 'M1', name: 'AlphaOne' })
      await flushPromises()

      expect(pinStore.isPokemonPinned('M1', 'AlphaOne')).toBe(true)
      expect(wrapper.vm.selectedPokemon).toContain('AlphaOne')
      expect(mockSolve).not.toHaveBeenCalled()

      const card = wrapper.find('[data-testid="house-card"]')
      expect(card.exists()).toBe(true)
      expect(card.text()).toContain('AlphaOne')

      // Auto-sort off → the "Unhoused pokemon" area stays visible (persistent
      // drop target) even when every pokemon is housed, showing the empty hint.
      const unhoused = wrapper.find('[data-testid="unhoused"]')
      expect(unhoused.exists()).toBe(true)
      expect(unhoused.text()).toContain('Unhoused pokemon')
      expect(unhoused.find('[data-testid="unhoused-empty-hint"]').exists()).toBe(true)
      expect(unhoused.findAll('[data-testid="pokemon-card"]')).toHaveLength(0)
    })

    // The OFF "Unhoused pokemon" area renders even when there is nothing to
    // unhouse (no houses, no selection) — so it is always a visible drop target
    // while auto-sort is off.
    it('keeps the unhoused area visible as a drop target while off, even empty', async () => {
      const wrapper = await mountHome()
      wrapper.vm.autoSort = false
      await flushPromises()

      const unhoused = wrapper.find('[data-testid="unhoused"]')
      expect(unhoused.exists()).toBe(true)
      expect(unhoused.text()).toContain('Unhoused pokemon')
      expect(unhoused.find('[data-testid="unhoused-empty-hint"]').exists()).toBe(true)
      expect(unhoused.findAll('[data-testid="pokemon-card"]')).toHaveLength(0)
    })

    // A pokemon selected only in the island search (never pinned to a house)
    // stays in the OFF warning, even while a different house holds a pinned
    // resident.
    it('keeps an unpinned island-only pokemon in the OFF warning', async () => {
      const wrapper = await mountHome()
      wrapper.vm.autoSort = false
      wrapper.vm.medium = 1
      await flushPromises()
      wrapper.vm.addPokemonToHouse({ houseId: 'M1', name: 'AlphaOne' })
      await flushPromises()

      // BetaOne is added via the island search only — no house pin.
      wrapper.vm.selectedPokemon = ['AlphaOne', 'BetaOne']
      await flushPromises()

      expect(mockSolve).not.toHaveBeenCalled()
      const house = wrapper.find('[data-testid="house-card"]')
      expect(house.text()).toContain('AlphaOne')
      expect(house.text()).not.toContain('BetaOne')
      const unhoused = wrapper.find('[data-testid="unhoused"]')
      expect(unhoused.exists()).toBe(true)
      expect(unhoused.text()).toContain('Unhoused pokemon')
      expect(unhoused.text()).toContain('BetaOne')
      expect(unhoused.text()).not.toContain('AlphaOne')
    })

    // AC.6 — flipping back ON re-solves immediately with pinned assignments.
    it('re-solves immediately on flip-on with pinned newcomers', async () => {
      const wrapper = await mountHome()

      wrapper.vm.autoSort = false
      wrapper.vm.medium = 1
      await flushPromises()
      wrapper.vm.addPokemonToHouse({ houseId: 'M1', name: 'AlphaOne' })
      await flushPromises()
      expect(mockSolve).not.toHaveBeenCalled()
      // The newcomer already shows in its house while OFF (pinned overlay).
      expect(wrapper.find('[data-testid="house-card"]').text()).toContain('AlphaOne')

      mockSolve.mockResolvedValueOnce({
        houses: [{ houseId: 'M1', size: 'medium', capacity: 2, pokemon: ['AlphaOne'] }],
        unhoused: [],
      })
      wrapper.vm.autoSort = true
      await flushPromises()

      expect(mockSolve).toHaveBeenCalledTimes(1)
      const pinnedAssignments = mockSolve.mock.calls[0]![4] as Map<string, string[]>
      expect(pinnedAssignments.get('M1')).toContain('AlphaOne')

      const card = wrapper.find('[data-testid="house-card"]')
      expect(card.text()).toContain('AlphaOne')
      expect(wrapper.find('[data-testid="unhoused"]').exists()).toBe(false)
    })

    // AC.7 — the toggle persists into the URL hash.
    it('serializes autoSort into the URL hash', async () => {
      const wrapper = await mountHome()
      wrapper.vm.autoSort = false
      await flushPromises()

      const decoded = JSON.parse(atob(window.location.hash.slice(1))) as Record<string, unknown>
      expect(decoded.autoSort).toBe(false)
    })

    // AC.7 — the toggle persists into saved islands.
    it('serializes autoSort into the saved-query payload', async () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem')

      const wrapper = await mountHome()
      wrapper.vm.autoSort = false
      wrapper.vm.confirmSave()

      const call = setItem.mock.calls.find(([key]) => key === 'pokehousing_saved_queries')
      expect(call).toBeDefined()
      const saved = JSON.parse(call![1] as string) as Array<{ autoSort?: boolean }>
      expect(saved[0]!.autoSort).toBe(false)
    })

    // AC.7 — restoring an off-state saved entry: toggle off, no initial solve,
    // synthesized houses + the warning.
    it('restores an off-state saved island without dispatching an initial solve', async () => {
      const entry = {
        title: 'Paused island',
        timestamp: 1700000000030,
        small: 1,
        medium: 0,
        large: 0,
        pokemon: ['AlphaOne'],
        autoSort: false,
      }
      vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify([entry]))

      const wrapper = await mountHome()
      const cartStore = useCartStore()
      vi.spyOn(cartStore, 'restoreItems').mockResolvedValue(undefined)

      wrapper.vm.selectedTimestamp = entry.timestamp
      await flushPromises()

      expect(wrapper.vm.autoSort).toBe(false)
      expect(mockSolve).not.toHaveBeenCalled()
      expect(wrapper.findAll('[data-testid="house-card"]')).toHaveLength(1)
      const unhoused = wrapper.find('[data-testid="unhoused"]')
      expect(unhoused.exists()).toBe(true)
      expect(unhoused.text()).toContain('AlphaOne')
    })

    // AC.7 — same for the URL-hash path.
    it('restores an off-state URL hash with synthesized houses and no initial solve', async () => {
      const shared = { small: 1, medium: 0, large: 0, pokemon: ['AlphaOne'], autoSort: false }
      window.location.hash = `#${btoa(JSON.stringify(shared))}`

      const wrapper = await mountHome()

      expect(wrapper.vm.autoSort).toBe(false)
      expect(mockSolve).not.toHaveBeenCalled()
      expect(wrapper.findAll('[data-testid="house-card"]')).toHaveLength(1)
      expect(wrapper.find('[data-testid="unhoused"]').text()).toContain('AlphaOne')
    })

    // AC.8 — hashes/saved entries WITHOUT the autoSort key restore with
    // sorting ON (legacy default).
    it('restores a legacy hash without the autoSort key with sorting ON', async () => {
      const shared = { small: 1, medium: 0, large: 0, pokemon: ['AlphaOne'] }
      window.location.hash = `#${btoa(JSON.stringify(shared))}`
      mockSolve.mockResolvedValue({
        houses: [{ houseId: 'S1', size: 'small', capacity: 1, pokemon: ['AlphaOne'] }],
        unhoused: [],
      })

      const wrapper = await mountHome()

      expect(wrapper.vm.autoSort).toBe(true)
      expect(mockSolve).toHaveBeenCalled()
    })

    // AC.9 — an in-flight solve resolving after flip-off is dropped.
    it('drops an in-flight solve that resolves after the toggle flips off', async () => {
      let resolveSolve!: (r: SolverResult) => void
      mockSolve.mockReturnValue(
        new Promise((res) => {
          resolveSolve = res
        }),
      )

      const wrapper = await mountHome()
      wrapper.vm.small = 1
      wrapper.vm.selectedPokemon = ['AlphaOne']
      await flushPromises()
      expect(mockSolve).toHaveBeenCalledTimes(1)
      expect(wrapper.vm.solving).toBe(true)

      wrapper.vm.autoSort = false
      await flushPromises()
      expect(wrapper.vm.solving).toBe(false)

      resolveSolve({
        houses: [{ houseId: 'S1', size: 'small', capacity: 1, pokemon: ['AlphaOne'] }],
        unhoused: [],
      })
      await flushPromises()

      // The late result is dropped: the registry-authoritative view shows an
      // empty house and AlphaOne in the warning — no transient re-sort.
      const card = wrapper.find('[data-testid="house-card"]')
      expect(card.exists()).toBe(true)
      expect(card.text()).not.toContain('AlphaOne')
      expect(wrapper.find('[data-testid="unhoused"]').text()).toContain('AlphaOne')
      expect(wrapper.vm.solving).toBe(false)
    })

    // AC.11 — stale arrangement retention: adding while off after a real solve
    // keeps the previous occupants in their house cards AND shows the newcomer
    // in its house (pinned overlay) without dispatching a solve. Pins the
    // hydration-race fix (result stays intact while the newcomer hydrates).
    it('adds to a house while off after a prior solve without wiping the arrangement', async () => {
      mockSolve.mockResolvedValue({
        houses: [{ houseId: 'L1', size: 'large', capacity: 4, pokemon: ['AlphaOne', 'AlphaTwo'] }],
        unhoused: [],
      })

      const wrapper = await mountHome()
      wrapper.vm.large = 1
      wrapper.vm.selectedPokemon = ['AlphaOne', 'AlphaTwo']
      await flushPromises()
      expect(mockSolve).toHaveBeenCalledTimes(1)

      wrapper.vm.autoSort = false
      await flushPromises()
      wrapper.vm.addPokemonToHouse({ houseId: 'L1', name: 'BetaOne' })
      await flushPromises()

      expect(mockSolve).toHaveBeenCalledTimes(1)

      const card = wrapper.find('[data-testid="house-card"]')
      expect(card.text()).toContain('AlphaOne')
      expect(card.text()).toContain('AlphaTwo')
      // The explicitly-added newcomer shows in its house immediately.
      expect(card.text()).toContain('BetaOne')

      // Auto-sort off → the persistent "Unhoused pokemon" area is still present
      // (empty hint), just containing none of the placed pokemon.
      const unhoused = wrapper.find('[data-testid="unhoused"]')
      expect(unhoused.exists()).toBe(true)
      expect(unhoused.find('[data-testid="unhoused-empty-hint"]').exists()).toBe(true)
      expect(unhoused.findAll('[data-testid="pokemon-card"]')).toHaveLength(0)
    })

    // AC.12 — count changes while OFF (with a prior solve) mutate the
    // registry-authoritative display: removing vanishes unpinned houses and
    // their occupants flow to the warning; adding renders empty houses
    // immediately. No solve is dispatched.
    it('updates the registry-authoritative display on count changes while off', async () => {
      mockSolve.mockResolvedValue({
        houses: [
          { houseId: 'S1', size: 'small', capacity: 1, pokemon: ['AlphaOne'] },
          { houseId: 'S2', size: 'small', capacity: 1, pokemon: ['AlphaTwo'] },
        ],
        unhoused: [],
      })

      const wrapper = await mountHome()
      wrapper.vm.small = 2
      wrapper.vm.selectedPokemon = ['AlphaOne', 'AlphaTwo']
      await flushPromises()
      expect(mockSolve).toHaveBeenCalledTimes(1)
      expect(wrapper.findAll('[data-testid="house-card"]')).toHaveLength(2)

      wrapper.vm.autoSort = false
      await flushPromises()

      // Reduce: S2 (highest counter, unpinned) is removed; its occupant flows
      // into the warning without a solve.
      wrapper.vm.small = 1
      await flushPromises()
      expect(wrapper.findAll('[data-testid="house-card"]')).toHaveLength(1)
      let unhoused = wrapper.find('[data-testid="unhoused"]')
      expect(unhoused.exists()).toBe(true)
      expect(unhoused.text()).toContain('AlphaTwo')
      expect(unhoused.text()).not.toContain('AlphaOne')
      expect(mockSolve).toHaveBeenCalledTimes(1)

      // Increase: a new empty medium house renders immediately.
      wrapper.vm.medium = 1
      await flushPromises()
      expect(wrapper.findAll('[data-testid="house-card"]')).toHaveLength(2)
      expect(mockSolve).toHaveBeenCalledTimes(1)
      unhoused = wrapper.find('[data-testid="unhoused"]')
      expect(unhoused.text()).toContain('AlphaTwo')
    })

    // Pinned occupants survive deselection in the OFF graft too — mirroring
    // prunePokemonData's pinned-pokemon survival rule, so a pinned pokemon
    // removed from the island search stays visible in its house card.
    it('keeps pinned deselected occupants in their house cards while off', async () => {
      mockSolve.mockResolvedValue({
        houses: [
          { houseId: 'S1', size: 'small', capacity: 1, pokemon: ['AlphaOne'] },
          { houseId: 'S2', size: 'small', capacity: 1, pokemon: ['AlphaTwo'] },
        ],
        unhoused: [],
      })

      const wrapper = await mountHome()
      const pinStore = usePinStore()
      wrapper.vm.small = 2
      wrapper.vm.selectedPokemon = ['AlphaOne', 'AlphaTwo']
      await flushPromises()

      pinStore.pinHouse('S2', ['AlphaTwo'])
      wrapper.vm.selectedPokemon = ['AlphaOne']
      await flushPromises()

      wrapper.vm.autoSort = false
      await flushPromises()

      const cards = wrapper.findAll('[data-testid="house-card"]')
      expect(cards).toHaveLength(2)
      // Pinned houses sort last (S2 is pinned via pinHouse).
      expect(cards[0]!.text()).toContain('AlphaOne')
      expect(cards[1]!.text()).toContain('AlphaTwo')
      // Both selected/assigned pokemon are covered by houses; the persistent
      // OFF "Unhoused pokemon" area is present but empty (drop target).
      const unhoused = wrapper.find('[data-testid="unhoused"]')
      expect(unhoused.exists()).toBe(true)
      expect(unhoused.find('[data-testid="unhoused-empty-hint"]').exists()).toBe(true)
      expect(unhoused.findAll('[data-testid="pokemon-card"]')).toHaveLength(0)
    })

    // AC.2 — the placement override relocates a pokemon between houses while
    // OFF without dispatching a solve.
    it('relocates a dragged pokemon between houses via the placement store while off', async () => {
      mockSolve.mockResolvedValue({
        houses: [
          { houseId: 'M1', size: 'medium', capacity: 2, pokemon: ['AlphaOne'] },
          { houseId: 'L1', size: 'large', capacity: 4, pokemon: ['AlphaTwo'] },
        ],
        unhoused: [],
      })

      const wrapper = await mountHome()
      wrapper.vm.medium = 1
      wrapper.vm.large = 1
      wrapper.vm.selectedPokemon = ['AlphaOne', 'AlphaTwo']
      await flushPromises()
      expect(mockSolve).toHaveBeenCalledTimes(1)

      wrapper.vm.autoSort = false
      await flushPromises()

      usePlacementStore().set('AlphaTwo', 'M1')
      await flushPromises()

      expect(mockSolve).toHaveBeenCalledTimes(1)
      const cards = wrapper.findAll('[data-testid="house-card"]')
      const m1 = cards.find((c) => c.text().includes('medium house M1'))!
      const l1 = cards.find((c) => c.text().includes('large house L1'))!
      expect(m1.text()).toContain('AlphaTwo')
      expect(m1.text()).toContain('AlphaOne')
      expect(l1.text()).not.toContain('AlphaTwo')
      // No pokemon are unhoused, but the persistent OFF area is still present.
      const unhoused = wrapper.find('[data-testid="unhoused"]')
      expect(unhoused.exists()).toBe(true)
      expect(unhoused.find('[data-testid="unhoused-empty-hint"]').exists()).toBe(true)
      expect(unhoused.findAll('[data-testid="pokemon-card"]')).toHaveLength(0)
    })

    // AC.3 — set(name, null) moves a housed pokemon into the warning while OFF.
    it('moves a housed pokemon into the warning via set(name, null) while off', async () => {
      mockSolve.mockResolvedValue({
        houses: [
          { houseId: 'S1', size: 'small', capacity: 1, pokemon: ['AlphaOne'] },
          { houseId: 'S2', size: 'small', capacity: 1, pokemon: ['AlphaTwo'] },
        ],
        unhoused: [],
      })

      const wrapper = await mountHome()
      wrapper.vm.small = 2
      wrapper.vm.selectedPokemon = ['AlphaOne', 'AlphaTwo']
      await flushPromises()
      wrapper.vm.autoSort = false
      await flushPromises()

      usePlacementStore().set('AlphaOne', null)
      await flushPromises()

      expect(mockSolve).toHaveBeenCalledTimes(1)
      const unhoused = wrapper.find('[data-testid="unhoused"]')
      expect(unhoused.exists()).toBe(true)
      expect(unhoused.text()).toContain('AlphaOne')
      expect(unhoused.text()).not.toContain('AlphaTwo')
      // S1 is now empty; S2 still holds AlphaTwo.
      const cards = wrapper.findAll('[data-testid="house-card"]')
      expect(cards.find((c) => c.text().includes('small house S2'))!.text()).toContain('AlphaTwo')
    })

    // AC.6 — flipping back on clears the session-only placement override.
    it('clears the placement override when auto-sort flips back on', async () => {
      const wrapper = await mountHome()
      const placementStore = usePlacementStore()

      wrapper.vm.autoSort = false
      await nextTick()
      placementStore.set('AlphaOne', 'M1')
      expect(placementStore.placements.size).toBe(1)

      wrapper.vm.autoSort = true
      await nextTick()
      await flushPromises()
      expect(placementStore.placements.size).toBe(0)
    })

    // AC.4 — the unhoused warning renders one PokemonCard per member.
    it('renders unhoused members as pokemon cards', async () => {
      const wrapper = await mountHome()
      wrapper.vm.autoSort = false
      wrapper.vm.selectedPokemon = ['AlphaOne', 'AlphaTwo']
      await flushPromises()

      const unhoused = wrapper.find('[data-testid="unhoused"]')
      expect(unhoused.exists()).toBe(true)
      expect(unhoused.find('[data-testid="unhoused-pokemon-grid"]').exists()).toBe(true)
      const cards = unhoused.findAll('[data-testid="pokemon-card"]')
      expect(cards).toHaveLength(2)
      expect(cards[0]!.text()).toContain('AlphaOne')
      expect(cards[1]!.text()).toContain('AlphaTwo')
      // The unhoused variant has no pin button.
      expect(unhoused.find('[data-testid="progress-checkbox-pokemon"]').exists()).toBe(false)
    })
  })
})
