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
  AlphaOne: { image: '', favorites: ['A', 'B', 'C', 'D', 'E'] },
  AlphaTwo: { image: '', favorites: ['A', 'B', 'C', 'D', 'F'] },
  BetaOne: { image: '', favorites: ['X', 'Y', 'Z', 'W', 'V'] },
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

    const button = wrapper.find('button[type="submit"]')
    expect(button.text()).toBe('Solve')

    expect(wrapper.find('.results').exists()).toBe(false)
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
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const cards = wrapper.findAll('.house-card')
    expect(cards).toHaveLength(2)

    expect(cards[0]!.text()).toContain('AlphaOne')
    expect(cards[0]!.text()).toContain('AlphaTwo')
    expect(cards[1]!.text()).toContain('BetaOne')

    expect(wrapper.find('.unhoused').exists()).toBe(false)
  })

  it('displays unhoused pokemon section', async () => {
    const solverResult: SolverResult = {
      houses: [{ houseIndex: 1, size: 'small', capacity: 1, pokemon: ['AlphaOne'] }],
      unhoused: ['AlphaTwo', 'BetaOne'],
    }
    mockSolve.mockResolvedValueOnce(solverResult)

    const wrapper = await mountHome()
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const unhoused = wrapper.find('.unhoused')
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
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const cards = wrapper.findAll('.house-card')
    expect(cards).toHaveLength(2)
    expect(cards[1]!.find('.empty').exists()).toBe(true)
    expect(cards[1]!.text()).toContain('Empty')
  })

  it('displays error when solver fails', async () => {
    mockSolve.mockRejectedValueOnce(new Error('Solver exploded'))

    const wrapper = await mountHome()
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const errorEl = wrapper.find('.error')
    expect(errorEl.exists()).toBe(true)
    expect(errorEl.text()).toContain('Solver exploded')
  })
})
