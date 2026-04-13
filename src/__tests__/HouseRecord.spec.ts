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

  it('hides shared habitats section when pokemon have different habitats', () => {
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'medium',
      capacity: 2,
      pokemon: ['AlphaOne', 'BetaOne'],
    }

    const wrapper = mount(HouseRecord, {
      props: {
        house,
        pokemonData: testPokemonData,
      },
    })

    const sharedHabitats = wrapper.find('[data-testid="shared-habitats"]')
    expect(sharedHabitats.exists()).toBe(false)
  })

  it('hides shared habitats section for single occupant', () => {
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
    expect(sharedHabitats.exists()).toBe(false)
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
    expect(badges).toHaveLength(1)
    expect(badges[0]!.text()).toContain('Dark')
    expect(badges[0]!.text()).toContain('2')
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

  it('shows only relaxation, decoration, and toy tagged items without a cluster cap', async () => {
    // Tag-filtered results: no 3-cluster limit, all items must have relevant tags
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

    // All displayed items must carry a relevant tag
    const tagBadges = wrapper.findAll('[data-testid="item-tag-badge"]')
    expect(tagBadges.length).toBeGreaterThan(0)
    const validTags = new Set(['Relaxation', 'Decoration', 'Toy'])
    for (const badge of tagBadges) {
      expect(validTags.has(badge.text())).toBe(true)
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

  it('tag fulfillment row always shows Relaxation, Toy, and Decoration badges', () => {
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['AlphaOne'],
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData: testPokemonData },
    })

    const row = wrapper.find('[data-testid="tag-fulfillment-status"]')
    expect(row.exists()).toBe(true)
    expect(wrapper.find('[data-testid="tag-status-relaxation"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tag-status-toy"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tag-status-decoration"]').exists()).toBe(true)
  })

  it('tag badges are danger before any cart items are added', () => {
    const house: HouseAssignment = {
      houseId: 'S1',
      size: 'small',
      capacity: 1,
      pokemon: ['AlphaOne'],
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData: testPokemonData },
    })

    for (const tag of ['relaxation', 'toy', 'decoration']) {
      const badge = wrapper.find(`[data-testid="tag-status-${tag}"]`)
      expect(badge.classes()).toContain('text-bg-danger')
      expect(badge.classes()).not.toContain('text-bg-success')
    }
  })

  it('tag badge turns success after adding a cart item with that tag', async () => {
    // Punching Bag (Exercise) has the Toy tag and appears in tagged recommendations
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

    // Find the first recommended item's tag badge to know which tag it carries
    const tagBadge = wrapper.find('[data-testid="item-tag-badge"]')
    expect(tagBadge.exists()).toBe(true)
    const tagText = tagBadge.text().toLowerCase()

    // Confirm that tag status badge starts as danger
    const statusBadge = wrapper.find(`[data-testid="tag-status-${tagText}"]`)
    expect(statusBadge.classes()).toContain('text-bg-danger')

    // Add the item to cart — get its name from the recommended list
    const itemName = wrapper.find('[data-testid="item-name"]').text()
    const cartStore = useCartStore()
    await cartStore.addItem('S1', itemName)
    await flushPromises()

    expect(statusBadge.classes()).toContain('text-bg-success')
    expect(statusBadge.classes()).not.toContain('text-bg-danger')
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

  it('recommended item row shows checkmark when item is in cart, clears when removed', async () => {
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

    // Before adding: no checkmark
    const checkCells = wrapper.findAll('[data-testid="item-in-cart-check"]')
    const targetCell = checkCells.find(
      (_, i) => wrapper.findAll('[data-testid="item-name"]')[i]?.text() === itemName,
    )!
    expect(targetCell.text().trim()).toBe('')

    // After adding: checkmark appears
    await cartStore.addItem('S1', itemName)
    await flushPromises()
    expect(targetCell.text().trim()).toBe('✓')

    // After removing: checkmark clears
    cartStore.removeItem('S1', itemName)
    await flushPromises()
    expect(targetCell.text().trim()).toBe('')
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
