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

  it('emits favoriteClicked when a favorite badge is clicked', async () => {
    const wrapper = mount(PokemonCard, {
      props: {
        name: 'TestMon',
        image: 'test.png',
        favorites: ['Exercise'],
      },
    })

    await wrapper.find('[data-testid="fave-badge"]').trigger('click')

    expect(wrapper.emitted('favoriteClicked')).toEqual([['Exercise']])
  })

  it('emits favoriteClicked when Enter is pressed on a favorite badge', async () => {
    const wrapper = mount(PokemonCard, {
      props: {
        name: 'TestMon',
        image: 'test.png',
        favorites: ['Exercise'],
      },
    })

    await wrapper.find('[data-testid="fave-badge"]').trigger('keydown.enter')

    expect(wrapper.emitted('favoriteClicked')).toEqual([['Exercise']])
  })
})
