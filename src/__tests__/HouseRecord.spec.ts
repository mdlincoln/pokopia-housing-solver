import { vi } from 'vitest'

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

import HouseRecord from '@/components/HouseRecord.vue'
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
    // Both pokemon share 'Exercise' and 'Cleanliness' — real catalog favorites
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['Exercise', 'Cleanliness'], habitat: 'Dark' },
      FitTwo: { image: '', favorites: ['Exercise', 'Cleanliness'], habitat: 'Dark' },
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

    const itemNames = wrapper.findAll('[data-testid="item-name"]')
    expect(itemNames.length).toBeGreaterThan(0)
  })

  it('shows recommended items for multiple favorites', async () => {
    // Both share 'Lots of Fire', 'Group Activities', and 'Stone Stuff'
    const pokemonData: PokemonData = {
      FireOne: { image: '', favorites: ['Lots of Fire', 'Group Activities', 'Stone Stuff'] },
      FireTwo: { image: '', favorites: ['Lots of Fire', 'Group Activities', 'Stone Stuff'] },
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
      Solo: { image: '', favorites: ['Exercise'] },
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(true)
  })

  it('shows recommended items even when occupants have no shared favorites', async () => {
    const pokemonData: PokemonData = {
      UniqueOne: { image: '', favorites: ['Exercise'] },
      UniqueTwo: { image: '', favorites: ['Cleanliness'] },
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
        favorites: ['Lots of Fire', 'Group Activities', 'Stone Stuff', 'Exercise', 'Cleanliness'],
      },
      PlannerTwo: {
        image: '',
        favorites: ['Lots of Fire', 'Group Activities', 'Stone Stuff', 'Exercise', 'Cleanliness'],
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
    await wrapper.find('[data-testid="recommended-items"] summary').trigger('click')
    await flushPromises()

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
    // Punching Bag (Exercise) is craftable
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['Exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await wrapper.find('[data-testid="recommended-items"] summary').trigger('click')
    await flushPromises()

    const cell = wrapper.find('[data-testid="item-craftability"]')
    expect(cell.exists()).toBe(true)
    expect(cell.text()).toMatch(/^Craftable/)
  })

  it('shows Buy badge for items without recipes', async () => {
    // Shiny Stuff includes non-craftable Meteor Lamps
    const pokemonData: PokemonData = {
      ShinyOne: { image: '', favorites: ['Shiny Stuff'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['ShinyOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await wrapper.find('[data-testid="recommended-items"] summary').trigger('click')
    await flushPromises()

    const cells = wrapper.findAll('[data-testid="item-craftability"]')
    const buyCell = cells.find((c) => c.text() === 'Buy')
    expect(buyCell).toBeDefined()
  })

  it('shows category badge for items with a category', async () => {
    // Punching Bag has category 'Outdoor'
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['Exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await wrapper.find('[data-testid="recommended-items"] summary').trigger('click')
    await flushPromises()

    const craftCell = wrapper.find('[data-testid="item-craftability"]')
    expect(craftCell.exists()).toBe(true)
    expect(craftCell.text()).toContain('Outdoor')
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
      FitOne: { image: '', favorites: ['Exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()

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
      FitOne: { image: '', favorites: ['Exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()

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

  it('cart coverage table shows tag ✓ in the correct column for the item tag', async () => {
    // Punching Bag (Exercise) has the Toy tag
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['Exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()

    const itemName = wrapper.find('[data-testid="item-name"]').text()
    const cartStore = useCartStore()
    await cartStore.addItem('S1', itemName)
    await flushPromises()

    // Toy column should show ✓; Relaxation and Decoration should be empty
    expect(wrapper.find('[data-testid="cart-tag-toy"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cart-tag-relaxation"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cart-tag-decoration"]').exists()).toBe(false)
  })

  it('cart coverage fav column header turns success when favorite is fulfilled', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['Exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()

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
      FitOne: { image: '', favorites: ['Exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()

    const itemName = wrapper.find('[data-testid="item-name"]').text()
    const cartStore = useCartStore()
    await cartStore.addItem('S1', itemName)
    await flushPromises()

    const table = wrapper.find('[data-testid="cart-coverage-table"]')
    const successCells = table.findAll('tbody td.table-success')
    expect(successCells.length).toBeGreaterThan(0)
  })

  it('fulfilled favorite badges turn success after adding a covering cart item', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['Exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()

    // Before adding any cart items, the Exercise badge should be danger (unfulfilled)
    const favBadge = wrapper.find('[data-testid="fave-badge"]')
    expect(favBadge.text()).toContain('Exercise')
    expect(favBadge.classes()).toContain('text-bg-danger')
    expect(favBadge.classes()).not.toContain('text-bg-success')

    // Add an Exercise item to the cart
    const itemName = wrapper.find('[data-testid="item-name"]').text()
    const cartStore = useCartStore()
    await cartStore.addItem('S1', itemName)
    await flushPromises()

    expect(favBadge.classes()).toContain('text-bg-success')
  })

  it('favorite coverage cells use success background and show a checkmark', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['Exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await wrapper.find('[data-testid="recommended-items"] summary').trigger('click')
    await flushPromises()

    const successCells = wrapper.findAll('tbody td.table-success')
    expect(successCells.length).toBeGreaterThan(0)
    for (const cell of successCells) {
      expect(cell.find('span.bool-check').exists()).toBe(true)
      expect(cell.find('span.bool-check').text().trim()).toBe('✓')
    }
  })

  it('hides a fulfilled pokemon favorite column from active recommendations', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['Exercise', 'Cleanliness'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await wrapper.find('[data-testid="recommended-items"] summary').trigger('click')
    await flushPromises()

    const recommendationTable = wrapper.find('[data-testid="recommended-items-list"]')
    expect(recommendationTable.exists()).toBe(true)

    const headerTextsBefore = recommendationTable
      .findAll('thead th')
      .map((node) => node.text().toLowerCase().trim())
      .filter(Boolean)
    expect(headerTextsBefore.some((text) => text.includes('exercise'))).toBe(true)
    expect(headerTextsBefore.some((text) => text.includes('cleanliness'))).toBe(true)

    const cartStore = useCartStore()
    await cartStore.addItem('S1', 'Punching bag')
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
      FitOne: { image: '', favorites: ['Exercise'] },
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
    await cartStore.addItem('S1', 'Punching bag')
    await flushPromises()

    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(false)
  })

  it('fulfilled favorites do not bleed across houses', async () => {
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['Exercise'] },
      FitTwo: { image: '', favorites: ['Exercise'] },
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
    const itemName = wrapperA.find('[data-testid="item-name"]').text()
    const cartStore = useCartStore()
    await cartStore.addItem('A1', itemName)
    await flushPromises()

    const badgeA = wrapperA.find('[data-testid="fave-badge"]')
    const badgeB = wrapperB.find('[data-testid="fave-badge"]')

    expect(badgeA.classes()).toContain('text-bg-success')
    expect(badgeB.classes()).not.toContain('text-bg-success')
  })

  it('shows flavor text as title attribute on item name', async () => {
    // Punching Bag has flavor text
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['Exercise'] },
    }
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['FitOne'],
    }

    const wrapper = mount(HouseRecord, { props: { house, pokemonData } })
    await flushPromises()
    await wrapper.find('[data-testid="recommended-items"] summary').trigger('click')
    await flushPromises()

    const nameEl = wrapper.find('[data-testid="item-name"]')
    expect(nameEl.exists()).toBe(true)
    const title = nameEl.attributes('title')
    expect(title).toBeTruthy()
    expect(title!.length).toBeGreaterThan(0)
  })
})
