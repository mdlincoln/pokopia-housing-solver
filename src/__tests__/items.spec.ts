import { describe, expect, it } from 'vitest'
import { idealItems } from '../items'

describe('idealItems', () => {
  it('returns empty map for empty favorites set', () => {
    const result = idealItems(new Set())
    expect(result.size).toBe(0)
  })

  it('returns empty map for unknown favorite', () => {
    const result = idealItems(new Set(['Nonexistent Favorite']))
    expect(result.size).toBe(0)
  })

  it('returns items for a single favorite with count 1', () => {
    const result = idealItems(new Set(['Exercise']))
    // Exercise has exactly one item: "Punching bag"
    expect(result.size).toBe(1)
    expect(result.get('Punching bag')).toBe(1)
  })

  it('counts items that appear in multiple input favorites', () => {
    // "Gaming bed" appears in both Colorful Stuff and Shiny Stuff
    const result = idealItems(new Set(['Colorful Stuff', 'Shiny Stuff']))
    expect(result.get('Gaming bed')).toBe(2)
  })

  it('returns count 1 for items unique to one favorite', () => {
    // "Stardust" is in Shiny Stuff but not in Colorful Stuff
    const result = idealItems(new Set(['Colorful Stuff', 'Shiny Stuff']))
    expect(result.get('Stardust')).toBe(1)
  })

  it('ignores unknown favorites mixed with valid ones', () => {
    const result = idealItems(new Set(['Exercise', 'Not A Real Favorite']))
    expect(result.size).toBe(1)
    expect(result.get('Punching bag')).toBe(1)
  })

  it('returns all items from a multi-item favorite', () => {
    const result = idealItems(new Set(['Cleanliness']))
    // Cleanliness: Bathtime set, Cleaning supplies, Shower, Bathtub, Bouncy blue bathtub, Water basin
    expect(result.size).toBe(6)
    for (const [, count] of result) {
      expect(count).toBe(1)
    }
  })

  it('counts shared items across three favorites', () => {
    // "Bonfire" appears in both Lots of Fire and Group Activities
    // "Campfire" appears in Lots of Fire and Stone Stuff
    const result = idealItems(new Set(['Lots of Fire', 'Group Activities', 'Stone Stuff']))
    expect(result.get('Bonfire')).toBe(2)
    expect(result.get('Campfire')).toBe(2)
  })
})
