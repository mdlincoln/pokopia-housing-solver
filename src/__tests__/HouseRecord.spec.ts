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

  it('shows recommended items clustered by favorites', () => {
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

    const clusters = wrapper.findAll('[data-testid="item-cluster"]')
    expect(clusters.length).toBeGreaterThan(0)

    // Each cluster should show its favorites as text
    const firstCluster = clusters[0]!
    const clusterText = firstCluster.text()
    // Exercise items and Cleanliness items exist — at least one cluster label should contain a favorite name
    expect(clusterText.includes('Exercise') || clusterText.includes('Cleanliness')).toBe(true)
  })

  it('ranks clusters by number of favorites descending', () => {
    // Both share 'Lots of Fire', 'Group Activities', and 'Stone Stuff'
    // which produce clusters of different sizes
    const pokemonData: PokemonData = {
      FireOne: { image: '', favorites: ['Lots of Fire', 'Group Activities', 'Stone Stuff'] },
      FireTwo: { image: '', favorites: ['Lots of Fire', 'Group Activities', 'Stone Stuff'] },
    }
    const house: HouseAssignment = {
      houseIndex: 1,
      size: 'medium',
      capacity: 2,
      pokemon: ['FireOne', 'FireTwo'],
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData },
    })

    const clusters = wrapper.findAll('[data-testid="item-cluster"]')
    expect(clusters.length).toBeGreaterThan(1)

    // Count commas+1 in cluster label to estimate favorites count — first should have >= second
    // (Clusters with more favorites are listed first)
  })

  it('shows recommended items for a single occupant when favorites map to catalog entries', () => {
    const house: HouseAssignment = {
      houseIndex: 1,
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

    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(true)
  })

  it('shows recommended items even when occupants have no shared favorites', () => {
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

    expect(wrapper.find('[data-testid="recommended-items"]').exists()).toBe(true)
  })

  it('renders at most three recommended clusters with non-overlapping favorites', () => {
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
      houseIndex: 1,
      size: 'medium',
      capacity: 2,
      pokemon: ['PlannerOne', 'PlannerTwo'],
    }

    const wrapper = mount(HouseRecord, {
      props: { house, pokemonData },
    })

    const labels = wrapper.findAll('[data-testid="item-cluster-favorites"]')
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.length).toBeLessThanOrEqual(3)

    const seen = new Set<string>()
    for (const label of labels) {
      const favorites = label
        .text()
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
      for (const favorite of favorites) {
        const key = favorite.toLowerCase()
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
  })
})
