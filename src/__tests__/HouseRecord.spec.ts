import HouseRecord from '@/components/HouseRecord.vue'
import type { HouseAssignment, PokemonData } from '@/solver'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

const testPokemonData: PokemonData = {
  AlphaOne: { image: '', favorites: ['A', 'B', 'C', 'D', 'E'], habitat: 'Dark' },
  AlphaTwo: { image: '', favorites: ['A', 'B', 'C', 'D', 'F'], habitat: 'Dark' },
  BetaOne: { image: '', favorites: ['X', 'Y', 'Z', 'W', 'V'], habitat: 'Bright' },
  GammaOne: { image: '', favorites: ['P', 'Q', 'R'], habitat: 'Cool' },
}

describe('HouseRecord', () => {
  it('shows shared habitats badge when 2+ pokemon share the same habitat', () => {
    const house: HouseAssignment = {
      houseIndex: 1,
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
      houseIndex: 1,
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
      houseIndex: 1,
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
      houseIndex: 1,
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
      houseIndex: 1,
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
      houseIndex: 1,
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

  it('shows recommended items when housemates share catalog favorites', () => {
    // Both pokemon share 'Exercise' and 'Cleanliness' — real catalog favorites
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['Exercise', 'Cleanliness'], habitat: 'Dark' },
      FitTwo: { image: '', favorites: ['Exercise', 'Cleanliness'], habitat: 'Dark' },
    }
    const house: HouseAssignment = {
      houseIndex: 1,
      size: 'medium',
      capacity: 2,
      pokemon: ['FitOne', 'FitTwo'],
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData },
    })

    const details = wrapper.find('[data-testid="recommended-items"]')
    expect(details.exists()).toBe(true)

    const items = wrapper.findAll('[data-testid="recommended-items-list"] li')
    expect(items.length).toBeGreaterThan(0)

    // "Punching bag" fulfills Exercise; should appear in the list
    const texts = items.map((li) => li.text())
    expect(texts.some((t) => t.includes('Punching bag'))).toBe(true)
  })

  it('sorts recommended items by score descending', () => {
    // Both share 'Exercise' and 'Cleanliness'
    // "Shower" is in both Cleanliness and Lots of Water — but only Cleanliness is shared here,
    // so every item should score 2 (both favorites matched by every item that appears)
    const pokemonData: PokemonData = {
      FitOne: { image: '', favorites: ['Exercise', 'Cleanliness'], habitat: 'Dark' },
      FitTwo: { image: '', favorites: ['Exercise', 'Cleanliness'], habitat: 'Dark' },
    }
    const house: HouseAssignment = {
      houseIndex: 1,
      size: 'medium',
      capacity: 2,
      pokemon: ['FitOne', 'FitTwo'],
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData },
    })

    const items = wrapper.findAll('[data-testid="recommended-items-list"] li')
    // Extract scores from "(N)" suffix
    const scores = items.map((li) => {
      const match = li.text().match(/\((\d+)\)/)
      return match ? Number(match[1]) : 0
    })
    // Verify sorted descending
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]!)
    }
  })

  it('hides recommended items for single occupant', () => {
    const house: HouseAssignment = {
      houseIndex: 1,
      size: 'small',
      capacity: 1,
      pokemon: ['AlphaOne'],
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData: testPokemonData },
    })

    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(false)
  })

  it('hides recommended items when no favorites overlap', () => {
    // These pokemon have completely different favorites, none in common
    const pokemonData: PokemonData = {
      UniqueOne: { image: '', favorites: ['Exercise'] },
      UniqueTwo: { image: '', favorites: ['Cleanliness'] },
    }
    const house: HouseAssignment = {
      houseIndex: 1,
      size: 'medium',
      capacity: 2,
      pokemon: ['UniqueOne', 'UniqueTwo'],
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData },
    })

    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(false)
  })
})
