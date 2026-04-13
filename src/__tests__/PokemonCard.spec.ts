import PokemonCard from '@/components/PokemonCard.vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

describe('PokemonCard', () => {
  it('shows habitat badge when habitat prop is provided', () => {
    const wrapper = mount(PokemonCard, {
      props: {
        name: 'TestMon',
        image: 'test.png',
        favorites: ['Shiny stuff'],
        habitat: 'Dark',
      },
    })

    const badge = wrapper.find('[data-testid="habitat-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('Dark')
  })

  it('hides habitat badge when habitat prop is undefined', () => {
    const wrapper = mount(PokemonCard, {
      props: {
        name: 'TestMon',
        image: 'test.png',
        favorites: ['Shiny stuff'],
        habitat: undefined,
      },
    })

    const badge = wrapper.find('[data-testid="habitat-badge"]')
    expect(badge.exists()).toBe(false)
  })

  it('applies correct Bootstrap variant class for each habitat', () => {
    const habitatVariants = {
      Dark: 'text-bg-dark',
      Bright: 'text-bg-warning',
      Cool: 'text-bg-info',
      Warm: 'text-bg-danger',
      Dry: 'text-bg-secondary',
      Humid: 'text-bg-success',
    }

    for (const [habitat, expectedClass] of Object.entries(habitatVariants)) {
      const wrapper = mount(PokemonCard, {
        props: {
          name: 'TestMon',
          image: 'test.png',
          favorites: [],
          habitat,
        },
      })

      const badge = wrapper.find('[data-testid="habitat-badge"]')
      expect(badge.exists()).toBe(true)
      expect(badge.classes()).toContain(expectedClass)
      expect(badge.text()).toBe(habitat)
    }
  })

  it('renders habitat badge as a pill', () => {
    const wrapper = mount(PokemonCard, {
      props: {
        name: 'TestMon',
        image: 'test.png',
        favorites: [],
        habitat: 'Dark',
      },
    })

    const badge = wrapper.find('[data-testid="habitat-badge"]')
    expect(badge.exists()).toBe(true)
    // bootstrap-vue-next uses 'rounded-pill' class for pill style
    expect(badge.classes()).toContain('rounded-pill')
  })

  it('favorite badges are danger when fulfilledFavorites is not provided', () => {
    const wrapper = mount(PokemonCard, {
      props: {
        name: 'TestMon',
        image: 'test.png',
        favorites: ['Exercise', 'Cleanliness'],
      },
    })

    const badges = wrapper.findAll('[data-testid="fave-badge"]')
    expect(badges).toHaveLength(2)
    for (const badge of badges) {
      expect(badge.classes()).toContain('text-bg-danger')
      expect(badge.classes()).not.toContain('text-bg-success')
    }
  })

  it('fulfilled favorite badge turns success; unfulfilled badge stays danger', () => {
    const wrapper = mount(PokemonCard, {
      props: {
        name: 'TestMon',
        image: 'test.png',
        favorites: ['Exercise', 'Cleanliness'],
        fulfilledFavorites: new Set(['exercise']),
      },
    })

    const badges = wrapper.findAll('[data-testid="fave-badge"]')
    expect(badges).toHaveLength(2)
    const exerciseBadge = badges.find((b) => b.text().includes('Exercise'))!
    const cleanlinessBadge = badges.find((b) => b.text().includes('Cleanliness'))!
    expect(exerciseBadge.classes()).toContain('text-bg-success')
    expect(cleanlinessBadge.classes()).toContain('text-bg-danger')
    expect(cleanlinessBadge.classes()).not.toContain('text-bg-success')
  })

  it('fulfilled favorites matching is case-insensitive', () => {
    const wrapper = mount(PokemonCard, {
      props: {
        name: 'TestMon',
        image: 'test.png',
        favorites: ['Shiny Stuff'],
        fulfilledFavorites: new Set(['shiny stuff']),
      },
    })

    const badge = wrapper.find('[data-testid="fave-badge"]')
    expect(badge.classes()).toContain('text-bg-success')
  })

  it('all favorite badges turn success when all are fulfilled', () => {
    const wrapper = mount(PokemonCard, {
      props: {
        name: 'TestMon',
        image: 'test.png',
        favorites: ['Exercise', 'Cleanliness', 'Shiny Stuff'],
        fulfilledFavorites: new Set(['exercise', 'cleanliness', 'shiny stuff']),
      },
    })

    const badges = wrapper.findAll('[data-testid="fave-badge"]')
    expect(badges).toHaveLength(3)
    for (const badge of badges) {
      expect(badge.classes()).toContain('text-bg-success')
    }
  })
})
