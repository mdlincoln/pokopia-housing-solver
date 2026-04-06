import type { SolverResult } from '@/solver'
import HomeView from '@/views/HomeView.vue'
import { flushPromises, mount } from '@vue/test-utils'
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

const testPokemonData = {
  AlphaOne: { image: '', favorites: ['A', 'B', 'C', 'D', 'E'], habitat: 'Dark' },
  AlphaTwo: { image: '', favorites: ['A', 'B', 'C', 'D', 'F'], habitat: 'Dark' },
  BetaOne: { image: '', favorites: ['X', 'Y', 'Z', 'W', 'V'], habitat: 'Bright' },
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(testPokemonData),
      }),
    ),
  )
}

async function mountHome() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: HomeView }],
  })
  router.push('/')
  await router.isReady()

  const wrapper = mount(HomeView, {
    global: { plugins: [router] },
  })
  await flushPromises()
  return wrapper
}

describe('HomeView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubFetch()
  })

  it('renders the form with house inputs and submit button', async () => {
    const wrapper = await mountHome()

    const inputs = wrapper.findAll('input[type="number"]')
    expect(inputs).toHaveLength(3)

    expect(wrapper.find('[data-testid="results"]').exists()).toBe(false)
  })

  it('displays results with all pokemon housed', async () => {
    const solverResult: SolverResult = {
      houses: [
        { houseIndex: 1, size: 'medium', capacity: 2, pokemon: ['AlphaOne', 'AlphaTwo'] },
        { houseIndex: 2, size: 'small', capacity: 1, pokemon: ['BetaOne'] },
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
      houses: [{ houseIndex: 1, size: 'small', capacity: 1, pokemon: ['AlphaOne'] }],
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
        { houseIndex: 1, size: 'large', capacity: 4, pokemon: ['AlphaOne'] },
        { houseIndex: 2, size: 'small', capacity: 1, pokemon: [] },
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
})
