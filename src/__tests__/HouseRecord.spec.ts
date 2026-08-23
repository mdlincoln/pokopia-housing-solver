import HouseRecord, { sameFavorites } from '@/components/HouseRecord.vue'
import type { HouseAssignment, PokemonData } from '@/solver'
import { useCartStore } from '@/stores/cart'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

const testPokemonData: PokemonData = {
  AlphaOne: { image: '', favorites: ['A', 'B', 'C', 'D', 'E'], habitat: 'Dark' },
  AlphaTwo: { image: '', favorites: ['A', 'B', 'C', 'D', 'F'], habitat: 'Dark' },
  BetaOne: { image: '', favorites: ['X', 'Y', 'Z', 'W', 'V'], habitat: 'Bright' },
  GammaOne: { image: '', favorites: ['P', 'Q', 'R'], habitat: 'Cool' },
}

// Return the craftability cell text for the recommendation-table row whose
// item-name cell equals ``name``. Recommendations are ordered, so this scopes
// the assertion to a specific item rather than assuming it is the first row.
function craftabilityOf(wrapper: ReturnType<typeof mount>, name: string): string {
  const nameCells = wrapper.findAll('[data-testid="item-name"]')
  const row = nameCells.find((cell) => cell.text() === name)?.element.closest('tr')
  expect(row).toBeDefined()
  const cell = row!.querySelector('[data-testid="item-craftability"]')
  expect(cell).not.toBeNull()
  return cell!.textContent ?? ''
}

// The recommendation table renders lazily — it mounts only after the
// <details data-testid="recommended-items"> panel has first been opened and
// stays mounted afterwards. jsdom's summary-click activation behavior does not
// reliably fire the toggle event within flushPromises, so this helper sets
// `open` and dispatches `toggle` directly (the component's latch handler only
// depends on those two).
async function openRecommendations(wrapper: ReturnType<typeof mount>) {
  const details = wrapper.find('[data-testid="recommended-items"]')
  expect(details.exists()).toBe(true)
  ;(details.element as HTMLDetailsElement).open = true
  await details.trigger('toggle')
  await flushPromises()
}

describe('HouseRecord', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('shows shared habitats badge when 2+ pokemon share the same habitat', () => {
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'medium',
      capacity: 2,
      pokemon: ['AlphaOne', 'AlphaTwo'],
    }

    const wrapper = mount(HouseRecord, {
      props: {
        house,
        pokemonData: testPokemonData,
      },
    })

    const sharedHabitats = wrapper.find('[data-testid="shared-habitats"]')
    expect(sharedHabitats.exists()).toBe(true)

    const badge = wrapper.find('[data-testid="shared-habitat-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('Dark')
    expect(badge.text()).toContain('2')
  })

  it('shows shared habitats section for single occupant', () => {
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['AlphaOne'],
    }

    const wrapper = mount(HouseRecord, {
      props: {
        house,
        pokemonData: testPokemonData,
      },
    })

    const sharedHabitats = wrapper.find('[data-testid="shared-habitats"]')
    expect(sharedHabitats.exists()).toBe(true)
  })

  it('passes habitat prop to each pokemon card', () => {
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'medium',
      capacity: 2,
      pokemon: ['AlphaOne', 'AlphaTwo'],
    }

    const wrapper = mount(HouseRecord, {
      props: {
        house,
        pokemonData: testPokemonData,
      },
    })

    const habitatBadges = wrapper.findAll('[data-testid="habitat-badge"]')
    expect(habitatBadges).toHaveLength(2)
    habitatBadges.forEach((badge) => {
      expect(badge.text()).toBe('Dark')
    })
  })

  it('shows shared habitats for multiple pairs (e.g., 3 pokemon with 2 habitats)', () => {
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'large',
      capacity: 4,
      pokemon: ['AlphaOne', 'AlphaTwo', 'GammaOne'],
    }

    const wrapper = mount(HouseRecord, {
      props: {
        house,
        pokemonData: testPokemonData,
      },
    })

    const sharedHabitats = wrapper.find('[data-testid="shared-habitats"]')
    expect(sharedHabitats.exists()).toBe(true)

    // Should show only Dark (×2), since Cool only has 1 pokemon
    const badges = wrapper.findAll('[data-testid="shared-habitat-badge"]')
    expect(badges).toHaveLength(2)
    expect(badges[0]!.text()).toContain('Dark')
    expect(badges[0]!.text()).toContain('2')
    expect(badges[1]!.text()).toContain('Cool')
    expect(badges[1]!.text()).toContain('1')
  })

  it('renders with correct data-testid on house card', () => {
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: [],
    }

    const wrapper = mount(HouseRecord, {
      props: {
        house,
        pokemonData: testPokemonData,
      },
    })

    const card = wrapper.find('[data-testid="house-card"]')
    expect(card.exists()).toBe(true)
  })

  it('shows recommended items as one row per item', async () => {
    // Both pokemon share 'exercise' and 'cleanliness' — real catalog favorites
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise', 'cleanliness'], habitat: 'Dark' },
      FitTwo: { image: '', favorites: ['exercise', 'cleanliness'], habitat: 'Dark' },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'medium',
      capacity: 2,
      pokemon: ['FitOne', 'FitTwo'],
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData },
    })
    await flushPromises()

    const details = wrapper.find('[data-testid="recommended-items"]')
    expect(details.exists()).toBe(true)

    await openRecommendations(wrapper)
    const itemNames = wrapper.findAll('[data-testid="item-name"]')
    expect(itemNames.length).toBeGreaterThan(0)
  })

  it('shows recommended items for multiple favorites', async () => {
    // Both share 'lots of fire', 'group activities', and 'stone stuff'
    const pokemonData: PokemonData = {
      FireOne: { image: '', favorites: ['lots of fire', 'group activities', 'stone stuff'] },
      FireTwo: { image: '', favorites: ['lots of fire', 'group activities', 'stone stuff'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'medium',
      capacity: 2,
      pokemon: ['FireOne', 'FireTwo'],
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData },
    })
    await flushPromises()
    await openRecommendations(wrapper)

    const itemNames = wrapper.findAll('[data-testid="item-name"]')
    expect(itemNames.length).toBeGreaterThan(0)
  })

  it('shows recommended items for a single occupant when favorites map to catalog entries', async () => {
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['Solo'],
    }

    const pokemonData: PokemonData = {
      Solo: { image: '', favorites: ['exercise'] },
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(true)
  })

  it('shows recommended items even when occupants have no shared favorites', async () => {
    const pokemonData: PokemonData = {
      UniqueOne: { image: '', favorites: ['exercise'] },
      UniqueTwo: { image: '', favorites: ['cleanliness'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'medium',
      capacity: 2,
      pokemon: ['UniqueOne', 'UniqueTwo'],
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(true)
  })

  it('shows only relaxation, decoration, and toy tagged recommended items', async () => {
    // Tag-filtered results: every displayed recommendation row must have exactly one tag
    // column ✓. Tag ✓ marks render as <span class="text-success">✓</span>; fav coverage
    // cells use table-success on the <td> directly (no inner span), so counting text-success
    // spans isolates tag column hits.
    const pokemonData: PokemonData = {
      PlannerOne: {
        image: '',
        favorites: ['lots of fire', 'group activities', 'stone stuff', 'exercise', 'cleanliness'],
      },
      PlannerTwo: {
        image: '',
        favorites: ['lots of fire', 'group activities', 'stone stuff', 'exercise', 'cleanliness'],
      },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'medium',
      capacity: 2,
      pokemon: ['PlannerOne', 'PlannerTwo'],
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData },
    })
    await flushPromises()
    await openRecommendations(wrapper)

    const table = wrapper.find('[data-testid="recommended-items-list"]')
    const rows = table.findAll('tbody tr')
    expect(rows.length).toBeGreaterThan(0)

    // Each item carries at least one tag, so each row should have at least one bool-check span.
    // Both tag and fav coverage cells now render <span class="bool-check">✓</span>.
    for (const row of rows) {
      const boolChecks = row.findAll('td span.bool-check')
      expect(boolChecks.length).toBeGreaterThan(0)
    }
  })

  it('shows craftable badge for items that have recipes', async () => {
    // Punching Bag (exercise) is craftable
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    // 'exercise' returns several Toy-tagged recommendations ordered
    // alphabetically, so locate the Punching Bag row specifically rather than
    // assuming it is the first row.
    expect(craftabilityOf(wrapper, 'Punching Bag')).toMatch(/^Craftable/)
  })

  it('shows Buy badge for items without recipes', async () => {
    // Shiny Stuff includes non-craftable Meteor Lamps
    const pokemonData: PokemonData = {
      ShinyOne: { image: '', favorites: ['shiny stuff'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['ShinyOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const cells = wrapper.findAll('[data-testid="item-craftability"]')
    const buyCell = cells.find((c) => c.text() === 'Buy')
    expect(buyCell).toBeDefined()
  })

  it('shows category badge for items with a category', async () => {
    // Punching Bag has category 'Outdoor'
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    // Punching Bag's craftability text includes its category.
    expect(craftabilityOf(wrapper, 'Punching Bag')).toBe('Craftable (Outdoor)')
  })

  it('exposes screen-reader names for the visually empty image/actions columns in both tables', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const recsHeaders = wrapper.findAll(
      '[data-testid="recommended-items-list"] th span.visually-hidden',
    )
    expect(recsHeaders.map((h) => h.text()).sort()).toEqual(['Actions', 'Item image'])

    const itemName = wrapper.find('[data-testid="item-name"]').text()
    const cartStore = useCartStore()

    await cartStore.addItem('S1', itemName)
    await flushPromises()

    const coverageHeaders = wrapper.findAll(
      '[data-testid="cart-coverage-table"] th span.visually-hidden',
    )
    expect(coverageHeaders.map((h) => h.text()).sort()).toEqual(['Actions', 'Item image'])
  })

  it('cart coverage table is hidden when cart is empty', async () => {
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['AlphaOne'],
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData: testPokemonData },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="cart-items-coverage"]').exists()).toBe(false)
  })

  it('cart coverage table appears with correct rows after adding cart items', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const itemName = wrapper.find('[data-testid="item-name"]').text()
    const cartStore = useCartStore()
    await cartStore.addItem('S1', itemName)
    await flushPromises()

    const coverage = wrapper.find('[data-testid="cart-items-coverage"]')
    expect(coverage.exists()).toBe(true)
    const nameCell = coverage.find('[data-testid="item-name"]')
    expect(nameCell.exists()).toBe(true)
    expect(nameCell.text()).toBe(itemName)
  })

  it('cart coverage remove button deletes item from cart and hides table', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const itemName = wrapper.find('[data-testid="item-name"]').text()
    const cartStore = useCartStore()
    await cartStore.addItem('S1', itemName)
    await flushPromises()

    expect(wrapper.find('[data-testid="cart-items-coverage"]').exists()).toBe(true)

    await wrapper.find('[data-testid="cart-coverage-remove"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="cart-items-coverage"]').exists()).toBe(false)
    expect(cartStore.itemsByHouse.get('S1') ?? []).toHaveLength(0)
  })

  it('places the Placed checkbox and remove button in separate coverage cells (AC.2)', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const itemName = wrapper.find('[data-testid="item-name"]').text()
    const cartStore = useCartStore()
    await cartStore.addItem('S1', itemName)
    await flushPromises()

    const row = wrapper.find('[data-testid="cart-coverage-remove"]').element.closest('tr')
    expect(row).not.toBeNull()

    const placedCell = wrapper
      .find('[data-testid="progress-checkbox-placed-coverage"]')
      .element.closest('td')
    const removeCell = wrapper.find('[data-testid="cart-coverage-remove"]').element.closest('td')
    expect(placedCell).not.toBeNull()
    expect(removeCell).not.toBeNull()
    // Non-destructive placed toggles and destructive removal must not share a cell
    expect(placedCell).not.toBe(removeCell)
  })

  it('cart coverage table shows tag ✓ in the correct column for the item tag', async () => {
    // Punching Bag (exercise) has the Toy tag
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const itemName = wrapper.find('[data-testid="item-name"]').text()
    const cartStore = useCartStore()
    await cartStore.addItem('S1', itemName)
    await flushPromises()

    // Toy column should be hidden once fulfilled by an item in cart; others still present
    const coverageTable = wrapper.find('[data-testid="cart-coverage-table"]')
    const headers = coverageTable.findAll('th')
    expect(headers.some((h) => h.text().includes('Toy'))).toBe(false)
    expect(headers.some((h) => h.text().includes('Relaxation'))).toBe(true)
    expect(headers.some((h) => h.text().includes('Decoration'))).toBe(true)
  })

  it('cart coverage fav column header turns success when favorite is fulfilled', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const itemName = wrapper.find('[data-testid="item-name"]').text()
    const cartStore = useCartStore()
    await cartStore.addItem('S1', itemName)
    await flushPromises()

    // The fav column header for 'exercise' should have text-success once the item is in cart
    const favHeader = wrapper.find('[data-testid="fav-header-fav_exercise"]')
    expect(favHeader.exists()).toBe(true)
    expect(favHeader.classes()).toContain('text-success')
  })

  it('cart coverage fav cell shows success background for covered favorite', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const itemName = wrapper.find('[data-testid="item-name"]').text()
    const cartStore = useCartStore()
    await cartStore.addItem('S1', itemName)
    await flushPromises()

    const table = wrapper.find('[data-testid="cart-coverage-table"]')
    const successCells = table.findAll('tbody td.table-success')
    expect(successCells.length).toBeGreaterThan(0)
  })

  it('fulfilled favorite rows show ✓ after adding a covering cart item', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()

    const exerciseRow = () =>
      wrapper
        .findAll('[data-testid="fave-badge"]')
        .find((b) => b.text().includes('exercise'))!
        .element.closest('tr')!

    // Before adding any cart items, the exercise row shows no checkmark
    expect(exerciseRow().querySelector('span.bool-check')).toBeNull()

    // Add an Exercise item to the cart
    await openRecommendations(wrapper)
    const itemName = wrapper.find('[data-testid="item-name"]').text()
    const cartStore = useCartStore()
    await cartStore.addItem('S1', itemName)
    await flushPromises()

    // Re-find from the live wrapper; the exercise row now shows the ✓
    const check = exerciseRow().querySelector('span.bool-check')
    expect(check).not.toBeNull()
    expect(check!.textContent).toBe('✓')
  })

  it('favorite coverage cells use success background and show a checkmark', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const successCells = wrapper.findAll('tbody td.table-success')
    expect(successCells.length).toBeGreaterThan(0)
    for (const cell of successCells) {
      expect(cell.find('span.bool-check').exists()).toBe(true)
      expect(cell.find('span.bool-check').text().trim()).toBe('✓')
    }
  })

  it('hides a fulfilled pokemon favorite column from active recommendations', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise', 'cleanliness'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const recommendationTable = wrapper.find('[data-testid="recommended-items-list"]')
    expect(recommendationTable.exists()).toBe(true)

    const headerTextsBefore = recommendationTable
      .findAll('thead th')
      .map((node) => node.text().toLowerCase().trim())
      .filter(Boolean)
    expect(headerTextsBefore.some((text) => text.includes('exercise'))).toBe(true)
    expect(headerTextsBefore.some((text) => text.includes('cleanliness'))).toBe(true)

    const cartStore = useCartStore()
    await cartStore.addItem('S1', 'Punching Bag')
    await flushPromises()

    const headerTextsAfter = recommendationTable
      .findAll('thead th')
      .map((node) => node.text().toLowerCase().trim())
      .filter(Boolean)
    expect(headerTextsAfter.some((text) => text.includes('exercise'))).toBe(false)
    expect(headerTextsAfter.some((text) => text.includes('cleanliness'))).toBe(true)
  })

  // @lat: [[ui#House#Item Metadata Display#Hides recommendations when every favorite is fulfilled]]
  it('hides recommendations entirely when every favorite is fulfilled', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()

    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(true)

    const cartStore = useCartStore()
    await cartStore.addItem('S1', 'Punching Bag')
    await flushPromises()

    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(false)
  })

  it('fulfilled favorites do not bleed across houses', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
      FitTwo: { image: '', favorites: ['exercise'] },
    }
    const houseA: HouseAssignment = {
      houseId: 'A1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }
    const houseB: HouseAssignment = {
      houseId: 'B1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitTwo'],
    }

    const wrapperA = mount(HouseRecord, { props: { house: houseA, pokemonData } })
    const wrapperB = mount(HouseRecord, { props: { house: houseB, pokemonData } })
    await flushPromises()

    // Add item only to house A
    await openRecommendations(wrapperA)
    const itemName = wrapperA.find('[data-testid="item-name"]').text()
    const cartStore = useCartStore()
    await cartStore.addItem('A1', itemName)
    await flushPromises()

    const badgeA = wrapperA.find('[data-testid="fave-badge"]')
    const badgeB = wrapperB.find('[data-testid="fave-badge"]')

    expect(badgeA.element.closest('tr')!.querySelector('span.bool-check')).not.toBeNull()
    expect(badgeB.element.closest('tr')!.querySelector('span.bool-check')).toBeNull()
  })

  it('shows flavor text as title attribute on item name', async () => {
    // Punching Bag has flavor text
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const nameEl = wrapper.find('[data-testid="item-name"]')
    expect(nameEl.exists()).toBe(true)
    const title = nameEl.attributes('title')
    expect(title).toBeTruthy()
    expect(title!.length).toBeGreaterThan(0)
  })

  it('does not throw when pokemonData is pruned while component is still mounted (TransitionGroup leave race)', async () => {
    // Regression: HouseRecord can briefly re-render after its pokemonData prop
    // is pruned (e.g. during deselection, clearAll, or URL restore) while a
    // TransitionGroup leave transition keeps it alive in the DOM. The template
    // must not crash on pokemonData[name]!.image when the entry is gone.
    // See: TypeError: Cannot read properties of undefined (reading 'image')
    const pokemonData: PokemonData = {
      FitOne: { image: 'fitone.png', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    // Capture render errors via Vue's errorHandler so the test fails (rather
    // than emitting an unhandled rejection) when the template throws.
    const errors: unknown[] = []
    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData },
      global: {
        config: {
          errorHandler(err: unknown) {
            errors.push(err)
          },
        },
      },
    })
    await flushPromises()

    // Simulate the race: prune the pokemon from pokemonData while the
    // HouseRecord is still mounted (as TransitionGroup does during its
    // leave animation). This must not throw.
    await wrapper.setProps({ pokemonData: {} })
    await flushPromises()

    expect(errors).toEqual([])
  })

  it('renders the recommendation table only after the panel is first opened, and keeps it mounted', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()

    // Panel shell visible, but the table is not in the DOM yet
    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="recommended-items-list"]').exists()).toBe(false)

    // First open latches the table into the DOM
    await openRecommendations(wrapper)
    expect(wrapper.find('[data-testid="recommended-items-list"]').exists()).toBe(true)

    // Collapsing again does not unmount it — repeat toggles are free
    const details = wrapper.find('[data-testid="recommended-items"]')
    ;(details.element as HTMLDetailsElement).open = false
    await details.trigger('toggle')
    await flushPromises()
    expect(wrapper.find('[data-testid="recommended-items-list"]').exists()).toBe(true)
  })

  it('keeps the fulfilledFavorites Set identity stable when watch re-runs with unchanged contents', async () => {
    // Stub PokemonCard so we can capture the raw :fulfilled-favorites prop.
    const pokemonCardStub = {
      name: 'PokemonCard',
      props: ['name', 'image', 'favorites', 'habitat', 'checked', 'fulfilledFavorites'],
      template: '<div class="pokemon-card-stub"></div>',
    }
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'A1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData },
      global: { stubs: { PokemonCard: pokemonCardStub } },
    })
    await flushPromises()

    const card = wrapper.findComponent(pokemonCardStub)
    const propBefore = card.props('fulfilledFavorites')

    // Trigger a second watch run whose cart contents are equal but whose array
    // reference differs: adding an item to a DIFFERENT house makes this house's
    // houseCartItems computed return a fresh empty-array literal with identical
    // contents, re-firing the deep watch. The comparison in the watch must keep
    // the Set reference identical.
    const cartStore = useCartStore()
    await cartStore.addItem('B1', 'Punching Bag')
    await flushPromises()

    const propAfter = wrapper.findComponent(pokemonCardStub).props('fulfilledFavorites')
    expect(propAfter).toBe(propBefore)
  })

  it('house pin button exposes a state-aware accessible name (AC.2)', async () => {
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['AlphaOne'],
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData: testPokemonData },
    })

    const pin = wrapper.find('[data-testid="progress-checkbox-house"]')
    expect(pin.attributes('aria-label')).toBe('Pin this house (S1) so it stays put when re-solving')
    expect(pin.attributes('aria-checked')).toBe('false')

    await pin.trigger('click')
    expect(pin.attributes('aria-label')).toBe('Unpin house S1')
    expect(pin.attributes('aria-checked')).toBe('true')
  })

  it('add-to-cart and cart-coverage-remove buttons expose item + house names (AC.4)', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const itemName = wrapper.find('[data-testid="item-name"]').text()
    const addButton = wrapper.find('[data-testid="add-to-cart"]')
    expect(addButton.attributes('aria-label')).toBe(`Add ${itemName} to cart for house S1`)

    await addButton.trigger('click')
    await flushPromises()

    const removeButton = wrapper.find('[data-testid="cart-coverage-remove"]')
    expect(removeButton.exists()).toBe(true)
    expect(removeButton.attributes('aria-label')).toBe(`Remove ${itemName} from house S1 cart`)
  })

  it('clicking an unfulfilled favorite badge opens the panel sorted by that favorite (AC.3)', async () => {
    // Equal counts sort alphabetically, so the default column is fav_cleanliness;
    // clicking the 'exercise' badge must re-sort to fav_exercise.
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['cleanliness', 'exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()

    const details = wrapper.find('[data-testid="recommended-items"]')
    expect(details.exists()).toBe(true)
    expect((details.element as HTMLDetailsElement).open).toBe(false)

    const badges = wrapper.findAll('[data-testid="fave-badge"]')
    const exerciseBadge = badges.find((b) => b.text().includes('exercise'))
    expect(exerciseBadge).toBeDefined()
    await exerciseBadge!.trigger('click')
    await flushPromises()

    expect((details.element as HTMLDetailsElement).open).toBe(true)

    // The lazily mounted table must now exist
    const table = wrapper.find('[data-testid="recommended-items-list"]')
    expect(table.exists()).toBe(true)

    const sortedHeaders = table.findAll('th[aria-sort="descending"]')
    expect(sortedHeaders.length).toBe(1)
    expect(sortedHeaders[0]!.find('[data-testid="fav-header-fav_exercise"]').exists()).toBe(true)
  })

  it('clicking a fulfilled favorite badge is a silent no-op when the panel is gone (AC.3)', async () => {
    const errors: unknown[] = []
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData },
      global: {
        config: {
          errorHandler(err: unknown) {
            errors.push(err)
          },
        },
      },
    })
    await flushPromises()

    // Fulfill the only favorite — the recommendations panel disappears entirely
    const cartStore = useCartStore()
    await cartStore.addItem('S1', 'Punching Bag')
    await flushPromises()
    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(false)

    const badge = wrapper.find('[data-testid="fave-badge"]')
    expect(badge.element.closest('tr')!.querySelector('span.bool-check')).not.toBeNull()
    await badge.trigger('click')
    await flushPromises()

    expect(errors).toEqual([])
    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(false)
  })
})

describe('sameFavorites', () => {
  it('returns true for equal sets', () => {
    expect(sameFavorites(new Set(), new Set())).toBe(true)
    expect(sameFavorites(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true)
  })

  it('returns false for different contents or sizes', () => {
    expect(sameFavorites(new Set(['a']), new Set(['b']))).toBe(false)
    expect(sameFavorites(new Set(['a']), new Set(['a', 'b']))).toBe(false)
    expect(sameFavorites(new Set(), new Set(['a']))).toBe(false)
  })
})
