vi.mock('@/db', async () => {
  const { default: initSqlJs } = await import('sql.js')
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const wasmPath = resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm')
  const SQL = await initSqlJs({ locateFile: () => wasmPath })
  const dbPath = resolve(process.cwd(), 'public/pokehousing.sqlite')
  const db = new SQL.Database(new Uint8Array(readFileSync(dbPath)))
  return { getDb: async () => db }
})

import { loadAdjacencyMap, loadPokemonData, loadPokemonNames } from '@/queries'
import type { SolverResult } from '@/solver'
import { useCartStore } from '@/stores/cart'
import { usePinStore } from '@/stores/pins'
import { useProgressStore } from '@/stores/progress'
import HomeView from '@/views/HomeView.vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const mockSolve = vi.fn()

vi.mock('@/solver', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    solve: (...args: unknown[]) => mockSolve(...args),
  }
})

vi.mock('@/queries', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    loadPokemonNames: vi.fn(),
    loadPokemonData: vi.fn(),
    loadAdjacencyMap: vi.fn(),
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
    vi.mocked(loadAdjacencyMap).mockResolvedValue(new Map())
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
})
