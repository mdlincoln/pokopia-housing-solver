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

import { loadAdjacencyMap, loadPokemonData } from '@/queries'
import type { SolverResult } from '@/solver'
import { useCartStore } from '@/stores/cart'
import { usePinStore } from '@/stores/pins'
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
    vi.mocked(loadPokemonData).mockResolvedValue(testPokemonData)
    vi.mocked(loadAdjacencyMap).mockResolvedValue(new Map())
    window.location.hash = ''
  })

  it('renders the form with house inputs and submit button', async () => {
    const wrapper = await mountHome()

    const inputs = wrapper.findAll('input[type="number"]')
    expect(inputs).toHaveLength(3)

    expect(wrapper.find('[data-testid="results"]').exists()).toBe(false)
  })

  it('loads pokemon and adjacency data on mount', async () => {
    await mountHome()

    expect(loadPokemonData).toHaveBeenCalledOnce()
    expect(loadAdjacencyMap).toHaveBeenCalledOnce()
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
      quantity: 2,
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
    expect(saved[0].cart).toEqual([{ houseId: 'S1', name: 'Punching Bag', quantity: 2 }])
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

  it('opens favorite items modal from shared favorite pill', async () => {
    const sharedFavoriteData = {
      FitOne: { image: '', favorites: ['Exercise'], habitat: 'Dark' },
      FitTwo: { image: '', favorites: ['Exercise'], habitat: 'Dark' },
    }
    vi.mocked(loadPokemonData).mockResolvedValue(sharedFavoriteData)

    const solverResult: SolverResult = {
      houses: [{ houseId: 'S1', size: 'medium', capacity: 2, pokemon: ['FitOne', 'FitTwo'] }],
      unhoused: [],
    }
    mockSolve.mockResolvedValueOnce(solverResult)

    const wrapper = await mountHome()
    wrapper.vm.medium = 1
    wrapper.vm.selectedPokemon = ['FitOne', 'FitTwo']
    await flushPromises()

    await wrapper.find('[data-testid="shared-favorite-badge"]').trigger('click')
    await flushPromises()

    expect(wrapper.vm.showFavoriteItemsModal).toBe(true)
    expect(wrapper.vm.selectedFavorite).toBe('Exercise')
    expect(wrapper.vm.selectedFavoriteItems).toContain('Punching Bag')
  })

  it('opens favorite items modal from pokemon card favorite pill', async () => {
    const cardFavoriteData = {
      Solo: { image: '', favorites: ['Exercise'], habitat: 'Dark' },
    }
    vi.mocked(loadPokemonData).mockResolvedValue(cardFavoriteData)

    const solverResult: SolverResult = {
      houses: [{ houseId: 'S1', size: 'small', capacity: 1, pokemon: ['Solo'] }],
      unhoused: [],
    }
    mockSolve.mockResolvedValueOnce(solverResult)

    const wrapper = await mountHome()
    wrapper.vm.small = 1
    wrapper.vm.selectedPokemon = ['Solo']
    await flushPromises()

    await wrapper.find('[data-testid="fave-badge"]').trigger('click')
    await flushPromises()

    expect(wrapper.vm.showFavoriteItemsModal).toBe(true)
    expect(wrapper.vm.selectedFavorite).toBe('Exercise')
    expect(wrapper.vm.selectedFavoriteItems).toContain('Punching Bag')
  })

  it('shows related favorite pills for items in favorite modal', async () => {
    const wrapper = await mountHome()

    wrapper.vm.selectedFavorite = 'Shiny Stuff'
    wrapper.vm.showFavoriteItemsModal = true
    await flushPromises()

    const gamingBedRow = wrapper.vm.selectedFavoriteItemRows.find(
      (row: { item: string; otherFavorites: string[] }) => row.item === 'Gaming Bed',
    )
    expect(gamingBedRow).toBeDefined()
    if (!gamingBedRow) {
      throw new Error('Expected Gaming Bed row to be present in selectedFavoriteItemRows')
    }
    expect(gamingBedRow.otherFavorites).toContain('colorful stuff')
    expect(gamingBedRow.otherFavorites).not.toContain('shiny stuff')
  })

  it('includes craftable status in selectedFavoriteItemRows', async () => {
    const wrapper = await mountHome()

    wrapper.vm.selectedFavorite = 'Exercise'
    wrapper.vm.showFavoriteItemsModal = true
    await flushPromises()

    const row = wrapper.vm.selectedFavoriteItemRows.find(
      (r: { item: string }) => r.item === 'Punching Bag',
    )
    expect(row).toBeDefined()
    expect(row!.isCraftable).toBe(true)
  })

  it('includes non-craftable status in selectedFavoriteItemRows', async () => {
    const wrapper = await mountHome()

    wrapper.vm.selectedFavorite = 'Shiny Stuff'
    wrapper.vm.showFavoriteItemsModal = true
    await flushPromises()

    const row = wrapper.vm.selectedFavoriteItemRows.find(
      (r: { item: string }) => r.item === 'Red Meteor Lamp',
    )
    expect(row).toBeDefined()
    expect(row!.isCraftable).toBe(false)
  })

  it('includes category and flavor text in selectedFavoriteItemRows', async () => {
    const wrapper = await mountHome()

    wrapper.vm.selectedFavorite = 'Exercise'
    wrapper.vm.showFavoriteItemsModal = true
    await flushPromises()

    const row = wrapper.vm.selectedFavoriteItemRows.find(
      (r: { item: string }) => r.item === 'Punching Bag',
    )
    expect(row).toBeDefined()
    expect(row!.category).toBe('Outdoor')
    expect(row!.flavorText).toBeTruthy()
  })
})
