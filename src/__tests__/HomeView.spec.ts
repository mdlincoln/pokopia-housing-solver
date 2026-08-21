import { loadAdjacencyMap, loadPokemonData, loadPokemonNames } from '@/queries'
import type { SolverResult } from '@/solver'
import { useCartStore } from '@/stores/cart'
import { usePinStore } from '@/stores/pins'
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
  }
})

const testPokemonData = {
  AlphaOne: { image: '', favorites: ['A', 'B', 'C', 'D', 'E'], habitat: 'Dark' },
  AlphaTwo: { image: '', favorites: ['A', 'B', 'C', 'D', 'F'], habitat: 'Dark' },
  BetaOne: { image: '', favorites: ['X', 'Y', 'Z', 'W', 'V'], habitat: 'Bright' },
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
    window.location.hash = ''
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
    expect(wrapper.text()).toContain('Restoring saved query…')

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
    expect(cards[1]!.find('[data-testid="empty"]').exists()).toBe(true)
    expect(cards[1]!.text()).toContain('Empty')
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
})
