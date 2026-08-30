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

  it('renders a decorative inline svg in the habitat badge and each favorite row', () => {
    const wrapper = mount(PokemonCard, {
      props: {
        name: 'Bulbasaur',
        image: 'test.png',
        favorites: ['exercise', 'cleanliness'],
        habitat: 'Dark',
      },
    })

    // Habitat badge: aria-hidden wrapper enclosing an inline svg; label intact.
    const badge = wrapper.find('[data-testid="habitat-badge"]')
    expect(badge.exists()).toBe(true)
    const badgeGlyph = badge.find('.icon-glyph')
    expect(badgeGlyph.exists()).toBe(true)
    expect(badgeGlyph.attributes('aria-hidden')).toBe('true')
    expect(badgeGlyph.find('svg').exists()).toBe(true)
    expect(badge.text()).toBe('Dark')

    // Each mapped favorite row: glyph present, visible text unchanged.
    const faveButtons = wrapper.findAll('[data-testid="fave-badge"]')
    expect(faveButtons.map((b) => b.text())).toEqual(['exercise', 'cleanliness'])
    for (const button of faveButtons) {
      const glyph = button.find('.icon-glyph')
      expect(glyph.exists()).toBe(true)
      expect(glyph.attributes('aria-hidden')).toBe('true')
      expect(glyph.find('svg').exists()).toBe(true)
    }
  })

  it('an unmapped favorite renders text-only with no svg', () => {
    const wrapper = mount(PokemonCard, {
      props: {
        name: 'TestMon',
        image: 'test.png',
        favorites: ['totally unmapped favorite'],
      },
    })

    const button = wrapper.find('[data-testid="fave-badge"]')
    expect(button.text()).toBe('totally unmapped favorite')
    expect(button.find('.icon-glyph').exists()).toBe(false)
    expect(button.find('svg').exists()).toBe(false)
  })

  describe('spawn habitat thumbnails', () => {
    const spawnHabitats = [
      { id: 1, name: 'Tall Grass', image: 'images/habitats/1.png' },
      { id: 22, name: 'Bench with greenery', image: 'images/habitats/22.png' },
    ]
    const baseProps = { name: 'Bulbasaur', image: 'test.png', favorites: [] }

    it('renders one thumbnail button per spawnHabitats entry with a habitat-name aria-label', () => {
      const wrapper = mount(PokemonCard, {
        props: { ...baseProps, habitat: 'Dark', spawnHabitats },
      })

      const thumbs = wrapper.findAll('[data-testid="habitat-thumb"]')
      expect(thumbs).toHaveLength(2)
      expect(thumbs[0]!.attributes('aria-label')).toBe('View Tall Grass habitat details')
      expect(thumbs[1]!.attributes('aria-label')).toBe('View Bench with greenery habitat details')
      expect(thumbs[0]!.attributes('title')).toBe('Tall Grass')
    })

    it('renders no thumbnails without the prop or with an empty array', () => {
      const withoutProp = mount(PokemonCard, { props: { ...baseProps } })
      expect(withoutProp.find('[data-testid="habitat-thumbs"]').exists()).toBe(false)

      const withEmpty = mount(PokemonCard, {
        props: { ...baseProps, spawnHabitats: [] },
      })
      expect(withEmpty.find('[data-testid="habitat-thumbs"]').exists()).toBe(false)
    })

    it('thumbnails are native type=button controls wrapping the habitat image', () => {
      const wrapper = mount(PokemonCard, {
        props: { ...baseProps, spawnHabitats },
      })

      for (const thumb of wrapper.findAll('[data-testid="habitat-thumb"]')) {
        expect(thumb.element.tagName).toBe('BUTTON')
        expect(thumb.attributes('type')).toBe('button')
      }
      const img = wrapper.find('[data-testid="habitat-thumb"] img')
      expect(img.attributes('src')).toBe('/images/habitats/1.png')
      expect(img.attributes('alt')).toBe('Tall Grass')
      expect(img.attributes('loading')).toBe('lazy')
    })

    it('clicking a thumbnail emits habitatClicked with the habitat object', async () => {
      const wrapper = mount(PokemonCard, {
        props: { ...baseProps, spawnHabitats },
      })

      await wrapper.findAll('[data-testid="habitat-thumb"]')[1]!.trigger('click')
      expect(wrapper.emitted('habitatClicked')).toEqual([[spawnHabitats[1]]])
    })

    it('thumbnails render under the habitat pill inside the info column', () => {
      const wrapper = mount(PokemonCard, {
        props: { ...baseProps, habitat: 'Dark', spawnHabitats },
      })

      const badge = wrapper.find('[data-testid="habitat-badge"]')
      const thumbs = wrapper.find('[data-testid="habitat-thumbs"]')
      expect(badge.exists()).toBe(true)
      // Both live in the avatar row's info column, thumbs after (below) the pill.
      expect(thumbs.element.parentElement!.contains(badge.element)).toBe(true)
      expect(thumbs.element.previousElementSibling!.contains(badge.element)).toBe(true)
    })
  })

  describe('drag awareness', () => {
    const baseProps = { name: 'Bulbasaur', image: 'test.png', favorites: [] }

    it('shows the drag handle when dragEnabled and unlocked (house context)', () => {
      const wrapper = mount(PokemonCard, {
        props: { ...baseProps, dragEnabled: true, checked: false, context: 'house' },
      })
      const handle = wrapper.find('.pokemon-drag-handle')
      expect(handle.exists()).toBe(true)
      expect(handle.attributes('aria-hidden')).toBe('true')
      expect(handle.find('i.bi-arrows-move').exists()).toBe(true)
    })

    it('shows the drag handle in the unhoused context when dragEnabled', () => {
      const wrapper = mount(PokemonCard, {
        props: { ...baseProps, dragEnabled: true, context: 'unhoused' },
      })
      expect(wrapper.find('.pokemon-drag-handle').exists()).toBe(true)
    })

    it('shows a disabled handle that reveals a tooltip on hover when auto-sort is on', async () => {
      const wrapper = mount(PokemonCard, {
        props: { ...baseProps, dragEnabled: false, checked: false, context: 'house' },
      })
      const handle = wrapper.find('.pokemon-drag-handle')
      expect(handle.exists()).toBe(true)
      expect(handle.classes()).toContain('pokemon-drag-handle--disabled')
      // Tooltip only appears once the disabled handle is hovered, and no native
      // `title` is used (it could be cut off by the card's clipping).
      expect(handle.attributes('title')).toBeUndefined()
      expect(wrapper.find('.pokemon-drag-tooltip').exists()).toBe(false)
      await handle.trigger('mouseenter')
      const tip = wrapper.find('.pokemon-drag-tooltip')
      expect(tip.exists()).toBe(true)
      expect(tip.text()).toContain('only be moved manually when Auto-sort is off')
      await handle.trigger('mouseleave')
      expect(wrapper.find('.pokemon-drag-tooltip').exists()).toBe(false)
      // Not draggable, so the gesture is inert in HomeView.
      expect(wrapper.attributes('data-draggable')).toBe('false')
      expect(wrapper.classes()).not.toContain('pokemon-card--draggable')
    })

    it('shows an enabled handle with no tooltip and the grab affordance while off', async () => {
      const wrapper = mount(PokemonCard, {
        props: { ...baseProps, dragEnabled: true, checked: false, context: 'house' },
      })
      const handle = wrapper.find('.pokemon-drag-handle')
      expect(handle.exists()).toBe(true)
      expect(handle.classes()).not.toContain('pokemon-drag-handle--disabled')
      await handle.trigger('mouseenter')
      expect(wrapper.find('.pokemon-drag-tooltip').exists()).toBe(false)
      expect(wrapper.attributes('data-draggable')).toBe('true')
      expect(wrapper.classes()).toContain('pokemon-card--draggable')
    })

    it('hides the drag handle for a locked (checked) card', () => {
      const wrapper = mount(PokemonCard, {
        props: { ...baseProps, dragEnabled: true, checked: true, context: 'house' },
      })
      expect(wrapper.find('.pokemon-drag-handle').exists()).toBe(false)
      // The card root still carries the source attrs but reports non-draggable.
      expect(wrapper.attributes('data-draggable')).toBe('false')
    })

    it('marks the card root as a drag source with the expected attributes (house context)', () => {
      const wrapper = mount(PokemonCard, {
        props: {
          ...baseProps,
          dragEnabled: true,
          checked: false,
          context: 'house',
          houseId: 'M1',
        },
      })
      expect(wrapper.attributes('data-drag-source')).toBeDefined()
      expect(wrapper.attributes('data-drag-name')).toBe('Bulbasaur')
      expect(wrapper.attributes('data-from-house')).toBe('M1')
      expect(wrapper.attributes('data-draggable')).toBe('true')
      expect(wrapper.attributes('data-testid')).toBe('pokemon-card')
      expect(wrapper.classes()).toContain('pokemon-card--draggable')
    })

    it('sets data-from-house empty and draggable true in the unhoused context', () => {
      const wrapper = mount(PokemonCard, {
        props: { ...baseProps, dragEnabled: true, context: 'unhoused', houseId: null },
      })
      expect(wrapper.attributes('data-from-house')).toBe('')
      expect(wrapper.attributes('data-draggable')).toBe('true')
    })

    it('keeps the lock button in house context but drops it in the unhoused context', () => {
      const house = mount(PokemonCard, {
        props: { ...baseProps, context: 'house' },
      })
      expect(house.find('[data-testid="progress-checkbox-pokemon"]').exists()).toBe(true)

      const unhoused = mount(PokemonCard, {
        props: { ...baseProps, context: 'unhoused' },
      })
      expect(unhoused.find('[data-testid="progress-checkbox-pokemon"]').exists()).toBe(false)
    })

    it('renders favorites as non-buttons in the unhoused context', () => {
      const house = mount(PokemonCard, {
        props: { ...baseProps, favorites: ['exercise'], context: 'house' },
      })
      expect(house.find('[data-testid="fave-badge"]').element.tagName).toBe('BUTTON')

      const unhoused = mount(PokemonCard, {
        props: { ...baseProps, favorites: ['exercise'], context: 'unhoused' },
      })
      expect(unhoused.find('[data-testid="fave-badge"]').exists()).toBe(false)
      const span = unhoused.find('td .favorite-need')
      expect(span.exists()).toBe(true)
      expect(span.element.tagName).toBe('SPAN')
      expect(span.text()).toBe('exercise')
    })

    it('omits spawn-habitat thumbnails in the unhoused context', () => {
      const spawnHabitats = [{ id: 1, name: 'Tall Grass', image: 'images/habitats/1.png' }]
      const unhoused = mount(PokemonCard, {
        props: { ...baseProps, context: 'unhoused', spawnHabitats },
      })
      expect(unhoused.find('[data-testid="habitat-thumbs"]').exists()).toBe(false)

      const house = mount(PokemonCard, {
        props: { ...baseProps, context: 'house', spawnHabitats },
      })
      expect(house.find('[data-testid="habitat-thumbs"]').exists()).toBe(true)
    })
  })
})
