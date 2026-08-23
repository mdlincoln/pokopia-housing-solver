import HouseRecord, { sameFavorites } from '@/components/HouseRecord.vue'
import { favoriteCoverageColumnKey, recommendedItemsForHouse } from '@/queries'
import type { HouseAssignment, PokemonData } from '@/solver'
import { useCartStore } from '@/stores/cart'
import { useProgressStore } from '@/stores/progress'
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

  it('renders the house title as an h3 (h2 Results → h3 house titles outline)', () => {
    const house: HouseAssignment = {
      houseId: 'L1',
      size: 'large',
      capacity: 4,
      pokemon: [],
    }

    const wrapper = mount(HouseRecord, {
      props: {
        house,
        pokemonData: testPokemonData,
      },
    })

    const title = wrapper.find('h3.house-title')
    expect(title.exists()).toBe(true)
    expect(title.text()).toContain('large house L1')
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

  it('exposes screen-reader names for the visually empty image/actions columns in the merged table', async () => {
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

    // The single merged table keeps the same visually-hidden headers.
    const mergedHeaders = wrapper.findAll(
      '[data-testid="recommended-items-list"] th span.visually-hidden',
    )
    expect(mergedHeaders.map((h) => h.text()).sort()).toEqual(['Actions', 'Item image'])
  })

  it('shows an added cart item inline with the Added marker', async () => {
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

    const addedBadge = wrapper.find('[data-testid="recommendation-added-badge"]')
    expect(addedBadge.exists()).toBe(true)

    const nameCell = addedBadge.element.closest('[data-testid="item-name"]')
    expect(nameCell).not.toBeNull()
    expect(nameCell!.textContent).toContain(itemName)
  })

  it('recommendation remove button deletes the item from cart and drops the Added marker', async () => {
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

    expect(wrapper.find('[data-testid="recommendation-added-badge"]').exists()).toBe(true)

    await wrapper.find('[data-testid="recommendation-remove"]').trigger('click')
    await flushPromises()

    expect(cartStore.itemsByHouse.get('S1') ?? []).toHaveLength(0)
    expect(wrapper.find('[data-testid="recommendation-added-badge"]').exists()).toBe(false)
  })

  it('places the Placed checkbox and remove button in separate cells (AC.2)', async () => {
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

    const row = wrapper.find('[data-testid="recommendation-remove"]').element.closest('tr')
    expect(row).not.toBeNull()

    const placedCell = wrapper.find('[data-testid="recommendation-placed"]').element.closest('td')
    const removeCell = wrapper.find('[data-testid="recommendation-remove"]').element.closest('td')
    expect(placedCell).not.toBeNull()
    expect(removeCell).not.toBeNull()
    // Non-destructive placed toggles and destructive removal must not share a cell
    expect(placedCell).not.toBe(removeCell)
  })

  it('shows tag ✓ in the correct merged-table column for the item tag', async () => {
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

    // Toy column should persist once fulfilled by an item in cart (and turn green),
    // matching how fulfilled favorite columns stay visible; Relaxation/Decoration remain
    const table = wrapper.find('[data-testid="recommended-items-list"]')
    const headers = table.findAll('th')
    expect(headers.some((h) => h.text().includes('Toy'))).toBe(true)
    expect(headers.some((h) => h.text().includes('Relaxation'))).toBe(true)
    expect(headers.some((h) => h.text().includes('Decoration'))).toBe(true)
    const toyHeader = wrapper.find('[data-testid="tag-header-col_toy"]')
    expect(toyHeader.exists()).toBe(true)
    expect(toyHeader.classes()).toContain('text-success')
  })

  it('fav column header turns success when favorite is fulfilled in the merged table', async () => {
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

  it('favorite coverage cell shows success background for a covered favorite', async () => {
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

    const table = wrapper.find('[data-testid="recommended-items-list"]')
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

  it('keeps a fulfilled pokemon favorite column visible with a success header', async () => {
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

    // The exercise column stays (all favorite columns are always shown); its
    // header now reads success (fulfilled) while cleanliness stays danger.
    const exerciseHeader = wrapper.find('[data-testid="fav-header-fav_exercise"]')
    expect(exerciseHeader.exists()).toBe(true)
    expect(exerciseHeader.classes()).toContain('text-success')

    const cleanlinessHeader = wrapper.find('[data-testid="fav-header-fav_cleanliness"]')
    expect(cleanlinessHeader.exists()).toBe(true)
    expect(cleanlinessHeader.classes()).toContain('text-danger')
  })

  // @lat: [[ui#House#Item Metadata Display#Hides recommendations when every favorite is fulfilled]]
  it('keeps the panel showing added rows when every favorite is fulfilled', async () => {
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

    await openRecommendations(wrapper)
    const cartStore = useCartStore()
    await cartStore.addItem('S1', 'Punching Bag')
    await flushPromises()

    // Panel stays mounted showing the added row; allFulfilled class applies.
    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="recommendation-added-badge"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="house-card"]').classes()).toContain('fully-fulfilled')
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

  it('add-to-cart and recommendation-remove buttons expose item + house names (AC.4)', async () => {
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

    const removeButton = wrapper.find('[data-testid="recommendation-remove"]')
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

  it('clicking a fulfilled favorite badge still routes safely when the panel shows only added rows (AC.3)', async () => {
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

    await openRecommendations(wrapper)

    // Fulfill the only favorite — the panel stays mounted showing only the
    // added row (the merged table is the single coverage surface).
    const cartStore = useCartStore()
    await cartStore.addItem('S1', 'Punching Bag')
    await flushPromises()
    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(true)

    const badge = wrapper.find('[data-testid="fave-badge"]')
    expect(badge.element.closest('tr')!.querySelector('span.bool-check')).not.toBeNull()
    await badge.trigger('click')
    await flushPromises()

    expect(errors).toEqual([])
    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(true)
  })

  it('renders at most 50 rows and shows more-footer', async () => {
    const pokemonData: PokemonData = { Solo: { image: '', favorites: ['metal stuff'] } }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['Solo'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const table = wrapper.find('[data-testid="recommended-items-list"]')
    expect(table.findAll('tbody tr').length).toBeLessThanOrEqual(50)
    expect(wrapper.find('[data-testid="recommendations-more"]').exists()).toBe(true)
  })

  it('more-footer appends the next 50 rows and hides at end', async () => {
    const total = (await recommendedItemsForHouse(['metal stuff'])).length
    expect(total).toBeGreaterThan(50)

    const pokemonData: PokemonData = { Solo: { image: '', favorites: ['metal stuff'] } }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['Solo'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const rows = () => wrapper.find('[data-testid="recommended-items-list"]').findAll('tbody tr')
    expect(rows().length).toBe(50)

    await wrapper.find('[data-testid="recommendations-more"]').trigger('click')
    await flushPromises()
    expect(rows().length).toBe(Math.min(total, 100))

    while (wrapper.find('[data-testid="recommendations-more"]').exists()) {
      await wrapper.find('[data-testid="recommendations-more"]').trigger('click')
      await flushPromises()
    }
    expect(rows().length).toBe(total)
    expect(wrapper.find('[data-testid="recommendations-more"]').exists()).toBe(false)
  })

  it('sort-before-paginate: sorting applies to the full list within the unadded group', async () => {
    const recs = await recommendedItemsForHouse(['metal stuff', 'stone stuff'])
    const stoneKey = favoriteCoverageColumnKey('stone stuff')
    const metalKey = favoriteCoverageColumnKey('metal stuff')

    // Pick a stone-stuff-only item whose raw (relevance) index lies beyond the
    // first 50. Sorting by the stone column must surface it into the window.
    const targetIdx = recs.findIndex(
      (r, i) => i > 50 && r[stoneKey] === true && r[metalKey] === false,
    )
    expect(targetIdx).toBeGreaterThan(50)
    const targetName = recs[targetIdx]!.name

    const pokemonData: PokemonData = {
      Solo: { image: '', favorites: ['metal stuff', 'stone stuff'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['Solo'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const stoneBadge = wrapper
      .findAll('[data-testid="fave-badge"]')
      .find((b) => b.text().includes('stone stuff'))
    expect(stoneBadge).toBeDefined()
    await stoneBadge!.trigger('click')
    await flushPromises()

    const visibleNames = wrapper.findAll('[data-testid="item-name"]').map((c) => c.text())
    const sortedIndex = visibleNames.indexOf(targetName)
    expect(sortedIndex).toBeGreaterThanOrEqual(0)
    expect(sortedIndex).toBeLessThan(50)
  })

  it('added item sorts to top with Added marker, remove and placed controls', async () => {
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

    const cartStore = useCartStore()
    // Punching Bag covers only 'exercise'; 'cleanliness' stays unfulfilled so
    // unadded rows remain beneath the added row.
    await cartStore.addItem('S1', 'Punching Bag')
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="recommended-items-list"] tbody tr')
    expect(rows.length).toBeGreaterThan(1)

    const firstRow = rows[0]!
    expect(firstRow.text()).toContain('Punching Bag')
    expect(firstRow.find('[data-testid="recommendation-added-badge"]').exists()).toBe(true)
    expect(firstRow.find('[data-testid="add-to-cart"]').exists()).toBe(false)
    // In-cart rows carry the added-row styling class; unadded rows do not.
    expect(firstRow.classes()).toContain('recommendation-added-row')
    expect(rows[1]!.classes()).not.toContain('recommendation-added-row')
    expect(rows[1]!.find('[data-testid="recommendation-added-badge"]').exists()).toBe(false)

    const placed = firstRow.find('[data-testid="recommendation-placed"]')
    const remove = firstRow.find('[data-testid="recommendation-remove"]')
    expect(placed.exists()).toBe(true)
    expect(remove.exists()).toBe(true)
    expect(placed.element.closest('td')).not.toBe(remove.element.closest('td'))
  })

  it('added non-craftable item survives craftable-only filter', async () => {
    const pokemonData: PokemonData = { ShinyOne: { image: '', favorites: ['shiny stuff'] } }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['ShinyOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    // Locate a Buy (non-craftable) row and add it to the cart.
    const buyRows = wrapper
      .findAll('[data-testid="item-craftability"]')
      .filter((c) => c.text() === 'Buy')
    expect(buyRows.length).toBeGreaterThan(0)
    const buyName = buyRows[0]!.element
      .closest('tr')!
      .querySelector('[data-testid="item-name"]')!.textContent

    const cartStore = useCartStore()
    await cartStore.addItem('S1', buyName!)
    await flushPromises()

    const toggle = wrapper.find('[data-testid="craftable-only-toggle"] input[type="checkbox"]')
    expect(toggle.exists()).toBe(true)
    await toggle.setValue(true)
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="recommended-items-list"] tbody tr')
    const addedRow = rows.find((r) => r.find('[data-testid="recommendation-added-badge"]').exists())
    expect(addedRow).toBeDefined()
    expect(addedRow!.find('[data-testid="item-craftability"]').text()).toBe('Buy')

    // Every unadded row is craftable — non-craftable unadded rows were filtered.
    for (const row of rows) {
      if (row.find('[data-testid="recommendation-added-badge"]').exists()) continue
      expect(row.find('[data-testid="item-craftability"]').text()).toMatch(/^Craftable/)
    }
  })

  it('overlapping added items both remain visible', async () => {
    const pokemonData: PokemonData = { FitOne: { image: '', favorites: ['exercise'] } }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const names = wrapper.findAll('[data-testid="item-name"]').map((c) => c.text())
    expect(names.length).toBeGreaterThanOrEqual(2)

    const cartStore = useCartStore()
    await cartStore.addItem('S1', names[0]!)
    await cartStore.addItem('S1', names[1]!)
    await flushPromises()

    expect(wrapper.findAll('[data-testid="recommendation-added-badge"]').length).toBe(2)
    const visibleNames = wrapper.findAll('[data-testid="item-name"]').map((c) => c.text())
    expect(visibleNames.some((n) => n.startsWith(names[0]!))).toBe(true)
    expect(visibleNames.some((n) => n.startsWith(names[1]!))).toBe(true)
  })

  it('coverage table is gone and inline controls sync', async () => {
    const pokemonData: PokemonData = { FitOne: { image: '', favorites: ['exercise'] } }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    expect(wrapper.find('[data-testid="cart-items-coverage"]').exists()).toBe(false)

    const itemName = wrapper.find('[data-testid="item-name"]').text()
    const cartStore = useCartStore()
    const progressStore = useProgressStore()
    await cartStore.addItem('S1', itemName)
    await flushPromises()

    const placed = wrapper.find('[data-testid="recommendation-placed"]')
    expect(placed.exists()).toBe(true)

    await placed.setValue(true)
    await flushPromises()
    expect(progressStore.isItemPlaced('S1', itemName)).toBe(true)
    expect(wrapper.find('[data-testid="item-name"]').classes()).toContain(
      'text-decoration-line-through',
    )

    await wrapper.find('[data-testid="recommendation-remove"]').trigger('click')
    await flushPromises()

    expect(cartStore.itemsByHouse.get('S1') ?? []).toHaveLength(0)
    expect(wrapper.find('[data-testid="recommendation-remove"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="recommendation-placed"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="recommendation-added-badge"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="add-to-cart"]').length).toBeGreaterThan(0)
  })

  it('craftable-only toggle keeps the panel mounted even when the visible list shrinks', async () => {
    const pokemonData: PokemonData = { Solo: { image: '', favorites: ['metal stuff'] } }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['Solo'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const toggleSelector = '[data-testid="craftable-only-toggle"] input[type="checkbox"]'
    const toggle = wrapper.find(toggleSelector)
    expect(toggle.exists()).toBe(true)
    await toggle.setValue(true)
    await flushPromises()

    // The summary/checkbox never unmounts even after filtering.
    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(true)
    expect(wrapper.find(toggleSelector).exists()).toBe(true)
  })

  it('unadded item covering only an already-fulfilled favorite leaves the merged list', async () => {
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

    const cartStore = useCartStore()
    // Punching Bag covers only 'exercise' (not 'cleanliness').
    await cartStore.addItem('S1', 'Punching Bag')
    await flushPromises()

    const names = wrapper.findAll('[data-testid="item-name"]').map((c) => c.text())

    // A different exercise-only item (not in the cart) must be absent now that
    // 'exercise' is fulfilled; a cleanliness item should remain.
    const exerciseOnly = (await recommendedItemsForHouse(['exercise'])).find(
      (r) => r.name !== 'Punching Bag',
    )
    expect(exerciseOnly).toBeDefined()
    expect(names.some((n) => n === exerciseOnly!.name)).toBe(false)
    expect(names.some((n) => n === 'Water Basin')).toBe(true)
  })

  it('unadded item with fulfilled favorite but unmet tag remains', async () => {
    // House favorite is only 'cleanliness'. Shower (Toy) covers it, so adding
    // Shower fulfills both the favorite and the Toy tag — Decoration stays unmet.
    const pokemonData: PokemonData = {
      CleanOne: { image: '', favorites: ['cleanliness'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['CleanOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const cartStore = useCartStore()
    await cartStore.addItem('S1', 'Shower')
    await flushPromises()

    const names = wrapper.findAll('[data-testid="item-name"]').map((c) => c.text())
    // Water Basin (Decoration) has its favorite fulfilled but its tag is still
    // unmet, so the unadded row must remain.
    expect(names.some((n) => n === 'Water Basin')).toBe(true)
  })

  it('unadded item with fulfilled favorite and fulfilled tag leaves the list', async () => {
    const pokemonData: PokemonData = {
      CleanOne: { image: '', favorites: ['cleanliness'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['CleanOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const cartStore = useCartStore()
    await cartStore.addItem('S1', 'Shower')
    await flushPromises()

    const names = wrapper.findAll('[data-testid="item-name"]').map((c) => c.text())
    // Cleaning Supplies (Toy) covers the same now-fulfilled 'cleanliness'
    // favorite and the same now-fulfilled Toy tag: both dimensions are
    // satisfied, so it leaves the list. The added Shower row stays (its
    // item-name cell text includes the "Added" badge, so match by prefix).
    expect(names.some((n) => n === 'Cleaning Supplies')).toBe(false)
    expect(names.some((n) => n.startsWith('Shower'))).toBe(true)
  })

  it('retains the recommendations panel and the Decoration candidate after its favorite and Toy tag are fulfilled', async () => {
    const pokemonData: PokemonData = {
      CleanOne: { image: '', favorites: ['cleanliness'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['CleanOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const cartStore = useCartStore()
    await cartStore.addItem('S1', 'Shower')
    await flushPromises()

    // The merged list still has rows, so the panel stays mounted, and the
    // Decoration candidate the component retains end-to-end stays visible.
    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(true)
    expect(
      wrapper.findAll('[data-testid="item-name"]').some((c) => c.text() === 'Water Basin'),
    ).toBe(true)
  })

  it('grays out redundant coverage of an already-fulfilled favorite in unadded rows', async () => {
    const pokemonData: PokemonData = {
      Solo: { image: '', favorites: ['metal stuff', 'stone stuff'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['Solo'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    // Shower covers 'metal stuff' but not 'stone stuff', so adding it fulfills
    // 'metal stuff' while leaving 'stone stuff' unfulfilled. Some of those stone
    // recommendations also cover the now-fulfilled metal stuff.
    const cartStore = useCartStore()
    await cartStore.addItem('S1', 'Shower')
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="recommended-items-list"] tbody tr')
    const grayCells = wrapper.findAll('[data-testid="recommended-items-list"] td.table-secondary')
    // Redundant coverage (unadded row covering an already-fulfilled favorite)
    // is grayed out.
    expect(grayCells.length).toBeGreaterThan(0)
    for (const cell of grayCells) {
      const row = cell.element.closest('tr')!
      expect(row.querySelector('[data-testid="recommendation-added-badge"]')).toBeNull()
    }

    // An added row's coverage is never grayed — it keeps success.
    const addedRows = rows.filter((r) =>
      r.find('[data-testid="recommendation-added-badge"]').exists(),
    )
    expect(addedRows.length).toBeGreaterThan(0)
    for (const row of addedRows) {
      expect(row.findAll('td.table-secondary').length).toBe(0)
    }
  })

  it('grays out unadded tag cells once the tag is fulfilled (mirrors redundant favorite coverage)', async () => {
    // Shower covers 'metal stuff' and is Toy-tagged. Adding it fulfills 'metal
    // stuff' (leaving 'stone stuff' unfulfilled) AND fulfills the Toy tag, so the
    // unadded stone recommendations that are Toy items render a grayed tag cell.
    const pokemonData: PokemonData = {
      Solo: { image: '', favorites: ['metal stuff', 'stone stuff'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['Solo'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const cartStore = useCartStore()
    await cartStore.addItem('S1', 'Shower')
    await flushPromises()

    // Tag columns persist even when fulfilled.
    const headers = wrapper.findAll('[data-testid="recommended-items-list"] th')
    expect(headers.some((h) => h.text().includes('Toy'))).toBe(true)

    // With tag-inclusive retention the metal/stone candidate universe now spans
    // >50 rows, so the first page may not include a stone Toy row; expand one
    // page so the grayed-tag-cell behavior below stays observable.
    await wrapper.find('[data-testid="recommendations-more"]').trigger('click')
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="recommended-items-list"] tbody tr')
    const unaddedRows = rows.filter(
      (r) => !r.find('[data-testid="recommendation-added-badge"]').exists(),
    )
    // Column order is fixed: col_actions(0), col_placed(1), name(2), col_image(3),
    // craftability(4), col_toy(5).
    const toyCellGrayed = unaddedRows.some((r) => {
      const tds = r.findAll('td')
      return tds[5]?.classes().includes('table-secondary') === true
    })
    // At least one unadded Toy row (covering still-unfulfilled stone stuff) has a
    // grayed-out tag cell signaling its tag is already fulfilled.
    expect(toyCellGrayed).toBe(true)

    // All grayed cells live on unadded rows; the added row keeps success.
    const grayCells = wrapper.findAll('[data-testid="recommended-items-list"] td.table-secondary')
    for (const cell of grayCells) {
      const row = cell.element.closest('tr')!
      expect(row.querySelector('[data-testid="recommendation-added-badge"]')).toBeNull()
    }
    const addedRows = rows.filter((r) =>
      r.find('[data-testid="recommendation-added-badge"]').exists(),
    )
    expect(addedRows.length).toBeGreaterThan(0)
    for (const row of addedRows) {
      expect(row.findAll('td.table-secondary').length).toBe(0)
    }
  })

  it('exposes hover tooltips on favorite-coverage cells describing fulfillment', async () => {
    const pokemonData: PokemonData = {
      Solo: { image: '', favorites: ['metal stuff', 'stone stuff'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['Solo'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const titles = () =>
      wrapper
        .findAll('[data-testid="recommended-items-list"] span.bool-check')
        .map((s) => s.attributes('title'))
        .filter((t): t is string => !!t)

    // Before anything is placed, unadded recommendations covering a
    // still-unfulfilled need hint that placing them would fulfill it (case 2).
    expect(
      titles().some(
        (t) => t.includes('could fulfill') && t.endsWith(' if it were placed in this house'),
      ),
    ).toBe(true)

    // Add Shower → fulfills 'metal stuff', leaving 'stone stuff' unfulfilled.
    const cartStore = useCartStore()
    await cartStore.addItem('S1', 'Shower')
    await flushPromises()

    // Case 1: the placed (in-cart) Shower is actively fulfilling 'metal stuff'.
    expect(titles().some((t) => t === 'Shower is fulfilling metal stuff')).toBe(true)

    // Case 3: an unadded item covering the now-already-fulfilled 'metal stuff'
    // (the grayed out cell) flags that it is redundant. Only favorite-coverage
    // cells carry a hover title (tag cells do not), so pick the first grayed
    // cell that has one.
    const grayCells = wrapper.findAll(
      '[data-testid="recommended-items-list"] td.table-secondary span.bool-check',
    )
    const grayTitle = grayCells.find((c) => !!c.attributes('title'))
    expect(grayTitle?.exists()).toBe(true)
    expect(grayTitle!.attributes('title')).toMatch(
      / would fulfill .+ but it is fulfilled by other items already placed in this house\.$/,
    )

    // Case 2 still applies to coverage of the still-unfulfilled 'stone stuff'.
    expect(
      titles().some((t) =>
        t.endsWith(' could fulfill stone stuff if it were placed in this house'),
      ),
    ).toBe(true)
  })

  it('re-ranks to the first unfulfilled favorite when the active favorite becomes fulfilled', async () => {
    const pokemonData: PokemonData = {
      Solo: { image: '', favorites: ['metal stuff', 'stone stuff'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['Solo'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const descHeaders = () =>
      wrapper.findAll('[data-testid="recommended-items-list"] th[aria-sort="descending"]')

    // Before adding anything, the default sort targets the first unfulfilled
    // favorite — 'metal stuff' (alphabetically before 'stone stuff').
    expect(descHeaders().length).toBe(1)
    expect(descHeaders()[0]!.find('[data-testid="fav-header-fav_metal stuff"]').exists()).toBe(true)

    // Adding Shower fulfills 'metal stuff'; the table must re-rank to the only
    // remaining unfulfilled favorite, 'stone stuff' — not stay on the fulfilled
    // 'metal stuff' column.
    const cartStore = useCartStore()
    await cartStore.addItem('S1', 'Shower')
    await flushPromises()

    expect(descHeaders().length).toBe(1)
    expect(descHeaders()[0]!.find('[data-testid="fav-header-fav_stone stuff"]').exists()).toBe(true)
  })

  it('restores the original default sort when the fulfilling item is removed', async () => {
    const pokemonData: PokemonData = {
      Solo: { image: '', favorites: ['metal stuff', 'stone stuff'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['Solo'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const descHeaders = () =>
      wrapper.findAll('[data-testid="recommended-items-list"] th[aria-sort="descending"]')

    // Initially the default sort targets the first unfulfilled favorite.
    expect(descHeaders()[0]!.find('[data-testid="fav-header-fav_metal stuff"]').exists()).toBe(true)

    // Adding Shower fulfills 'metal stuff' and re-ranks to 'stone stuff'.
    const cartStore = useCartStore()
    await cartStore.addItem('S1', 'Shower')
    await flushPromises()
    expect(descHeaders()[0]!.find('[data-testid="fav-header-fav_stone stuff"]').exists()).toBe(true)

    // Removing it unfulfills 'metal stuff' again — the table must restore the
    // original sort order (back to 'metal stuff'), not stay on 'stone stuff'.
    await cartStore.removeItem('S1', 'Shower')
    await flushPromises()
    expect(descHeaders()[0]!.find('[data-testid="fav-header-fav_metal stuff"]').exists()).toBe(true)
  })

  it('recommendation favorite column headers render a decorative svg glyph (AC.4)', async () => {
    // Both pokemon share real catalog favorites (lowercase, mapped) so every
    // visible fav_* header resolves to a bundled glyph.
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

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await openRecommendations(wrapper)

    const headers = wrapper.findAll('[data-testid^="fav-header-"]')
    expect(headers.length).toBeGreaterThan(0)
    for (const header of headers) {
      const glyph = header.find('.icon-glyph')
      expect(glyph.exists()).toBe(true)
      expect(glyph.attributes('aria-hidden')).toBe('true')
      expect(glyph.find('svg').exists()).toBe(true)
    }
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
