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

  it('renders one row per favorite with no checkmarks when fulfilledFavorites is not provided', () => {
    const wrapper = mount(PokemonCard, {
      props: {
        name: 'TestMon',
        image: 'test.png',
        favorites: ['Exercise', 'Cleanliness'],
      },
    })

    const badges = wrapper.findAll('[data-testid="fave-badge"]')
    expect(badges).toHaveLength(2)
    expect(badges.map((b) => b.text())).toEqual(['Exercise', 'Cleanliness'])
    expect(wrapper.findAll('span.bool-check')).toHaveLength(0)
  })

  it('shows a bool-check only on fulfilled favorite rows', () => {
    const wrapper = mount(PokemonCard, {
      props: {
        name: 'TestMon',
        image: 'test.png',
        favorites: ['exercise', 'cleanliness'],
        fulfilledFavorites: new Set(['exercise']),
      },
    })

    const badges = wrapper.findAll('[data-testid="fave-badge"]')
    expect(badges).toHaveLength(2)
    const exerciseRow = badges.find((b) => b.text().includes('exercise'))!.element.closest('tr')!
    const cleanlinessRow = badges
      .find((b) => b.text().includes('cleanliness'))!
      .element.closest('tr')!
    const exerciseCheck = exerciseRow.querySelector('span.bool-check')
    expect(exerciseCheck).not.toBeNull()
    expect(exerciseCheck!.textContent).toBe('✓')
    expect(cleanlinessRow.querySelector('span.bool-check')).toBeNull()
  })

  it('fulfilled favorites matching is case-sensitive', () => {
    const exact = mount(PokemonCard, {
      props: {
        name: 'TestMon',
        image: 'test.png',
        favorites: ['shiny stuff'],
        fulfilledFavorites: new Set(['shiny stuff']),
      },
    })
    expect(exact.find('span.bool-check').exists()).toBe(true)

    const mismatched = mount(PokemonCard, {
      props: {
        name: 'TestMon',
        image: 'test.png',
        favorites: ['shiny stuff'],
        fulfilledFavorites: new Set(['Shiny Stuff']),
      },
    })
    expect(mismatched.find('span.bool-check').exists()).toBe(false)
  })

  it('shows a bool-check on every row when all favorites are fulfilled', () => {
    const wrapper = mount(PokemonCard, {
      props: {
        name: 'TestMon',
        image: 'test.png',
        favorites: ['exercise', 'cleanliness', 'shiny stuff'],
        fulfilledFavorites: new Set(['exercise', 'cleanliness', 'shiny stuff']),
      },
    })

    const badges = wrapper.findAll('[data-testid="fave-badge"]')
    expect(badges).toHaveLength(3)
    for (const badge of badges) {
      expect(badge.element.closest('tr')!.querySelector('span.bool-check')).not.toBeNull()
    }
  })

  it('pin button exposes a state-aware accessible name (AC.2)', () => {
    const unpinned = mount(PokemonCard, {
      props: { name: 'Bulbasaur', image: 'test.png', favorites: [], checked: false },
    })
    const unpinnedPin = unpinned.find('[data-testid="progress-checkbox-pokemon"]')
    expect(unpinnedPin.attributes('aria-label')).toBe('Pin Bulbasaur to this house')
    expect(unpinnedPin.attributes('aria-checked')).toBe('false')

    const pinned = mount(PokemonCard, {
      props: { name: 'Bulbasaur', image: 'test.png', favorites: [], checked: true },
    })
    const pinnedPin = pinned.find('[data-testid="progress-checkbox-pokemon"]')
    expect(pinnedPin.attributes('aria-label')).toBe('Unpin Bulbasaur')
    expect(pinnedPin.attributes('aria-checked')).toBe('true')
  })

  it('re-emits favoriteClicked when a favorite badge is clicked (AC.3 wiring)', async () => {
    const wrapper = mount(PokemonCard, {
      props: { name: 'Bulbasaur', image: 'test.png', favorites: ['shiny stuff'] },
    })

    await wrapper.find('[data-testid="fave-badge"]').trigger('click')
    expect(wrapper.emitted('favoriteClicked')).toEqual([['shiny stuff']])
  })

  it('renders the favorite control as a native button (native Enter/Space activation)', () => {
    // Enter/Space activation is browser behavior for <button type="button"> and
    // can't be synthesized by trigger('keydown.enter') under jsdom; the click
    // path itself is covered by the preceding test and real-browser e2e.
    const wrapper = mount(PokemonCard, {
      props: { name: 'Bulbasaur', image: 'test.png', favorites: ['exercise'] },
    })

    const control = wrapper.find('[data-testid="fave-badge"]')
    expect(control.element.tagName).toBe('BUTTON')
    expect(control.attributes('type')).toBe('button')
    expect(control.attributes('title')).toBe('Click to view items that fulfill this favorite')
    expect(control.text()).toBe('exercise')
  })

  it('favorites table is flush with the card (direct child, outside the padded body)', () => {
    const wrapper = mount(PokemonCard, {
      props: { name: 'Bulbasaur', image: 'test.png', favorites: ['exercise'] },
    })

    const table = wrapper.find('table.pokemon-favorites-table')
    expect(table.exists()).toBe(true)
    expect(table.classes()).toContain('mb-0')
    expect(table.classes()).toContain('table-sm')
    // Sibling of the image/body row — a direct child of the card root, not
    // nested inside the padded .pokemon-card-body
    expect(wrapper.find('.pokemon-card-body table.pokemon-favorites-table').exists()).toBe(false)
    expect(table.element.parentElement!.classList.contains('card')).toBe(true)
  })
})
