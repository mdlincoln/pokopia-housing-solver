import { describe, it, expect } from 'vitest'
import { enumerateHouses, countSharedFavorites, solve, type PokemonData } from '../solver'

const testData: PokemonData = {
  AlphaOne: { image: '', favorites: ['A', 'B', 'C', 'D', 'E'] },
  AlphaTwo: { image: '', favorites: ['A', 'B', 'C', 'D', 'F'] }, // 4 shared with AlphaOne
  BetaOne: { image: '', favorites: ['X', 'Y', 'Z', 'W', 'V'] }, // 0 shared with Alphas
  BetaTwo: { image: '', favorites: ['X', 'Y', 'Z', 'W', 'U'] }, // 4 shared with BetaOne
  Loner: { image: '', favorites: ['Q', 'R', 'S', 'T', 'P'] }, // 0 shared with anyone
}

describe('enumerateHouses', () => {
  it('enumerates houses with correct indices and capacities', () => {
    const result = enumerateHouses({ small: 2, medium: 1, large: 1 })
    expect(result).toEqual([
      { index: 1, size: 'small', capacity: 1 },
      { index: 2, size: 'small', capacity: 1 },
      { index: 3, size: 'medium', capacity: 2 },
      { index: 4, size: 'large', capacity: 4 },
    ])
  })

  it('returns empty array for zero counts', () => {
    expect(enumerateHouses({ small: 0, medium: 0, large: 0 })).toEqual([])
  })
})

describe('countSharedFavorites', () => {
  it('counts shared favorites correctly', () => {
    expect(countSharedFavorites('AlphaOne', 'AlphaTwo', testData)).toBe(4)
  })

  it('returns 0 for no overlap', () => {
    expect(countSharedFavorites('AlphaOne', 'BetaOne', testData)).toBe(0)
  })

  it('returns 0 for unknown pokemon', () => {
    expect(countSharedFavorites('AlphaOne', 'Unknown', testData)).toBe(0)
  })
})

describe('solve', () => {
  it('places 1 pokemon in 1 small house', async () => {
    const result = await solve(['AlphaOne'], { small: 1, medium: 0, large: 0 }, testData)
    expect(result.unhoused).toEqual([])
    expect(result.houses[0]!.pokemon).toEqual(['AlphaOne'])
  }, 30_000)

  it('leaves one unhoused when capacity is exceeded', async () => {
    const result = await solve(
      ['AlphaOne', 'AlphaTwo'],
      { small: 1, medium: 0, large: 0 },
      testData,
    )
    expect(result.houses[0]!.pokemon).toHaveLength(1)
    expect(result.unhoused).toHaveLength(1)
  }, 30_000)

  it('returns empty result for no pokemon', async () => {
    const result = await solve([], { small: 1, medium: 0, large: 0 }, testData)
    expect(result.unhoused).toEqual([])
    expect(result.houses[0]!.pokemon).toEqual([])
  })

  it('marks all unhoused when no houses exist', async () => {
    const result = await solve(
      ['AlphaOne', 'AlphaTwo'],
      { small: 0, medium: 0, large: 0 },
      testData,
    )
    expect(result.houses).toEqual([])
    expect(result.unhoused).toHaveLength(2)
  })

  it('fits all pokemon when capacity is sufficient', async () => {
    const result = await solve(
      ['AlphaOne', 'AlphaTwo', 'BetaOne'],
      { small: 0, medium: 0, large: 1 },
      testData,
    )
    expect(result.unhoused).toEqual([])
    expect(result.houses[0]!.pokemon).toHaveLength(3)
  }, 30_000)

  it('groups pokemon with shared favorites together', async () => {
    // AlphaOne & AlphaTwo share 4 favorites. BetaOne shares 0 with them.
    // 1 medium (cap 2) + 1 small (cap 1) should put the Alphas together.
    const result = await solve(
      ['AlphaOne', 'AlphaTwo', 'BetaOne'],
      { small: 1, medium: 1, large: 0 },
      testData,
    )
    expect(result.unhoused).toEqual([])

    const mediumHouse = result.houses.find((h) => h.size === 'medium')!
    expect(mediumHouse.pokemon.sort()).toEqual(['AlphaOne', 'AlphaTwo'])
  }, 30_000)

  it('clusters two natural pairs into separate houses', async () => {
    // AlphaOne+AlphaTwo (4 shared) and BetaOne+BetaTwo (4 shared)
    // Given 2 medium houses, each pair should end up together.
    const result = await solve(
      ['AlphaOne', 'AlphaTwo', 'BetaOne', 'BetaTwo'],
      { small: 0, medium: 2, large: 0 },
      testData,
    )
    expect(result.unhoused).toEqual([])

    const house1Pokemon = result.houses[0]!.pokemon.sort()
    const house2Pokemon = result.houses[1]!.pokemon.sort()

    // Each house should contain one of the natural pairs
    const pairs = [house1Pokemon, house2Pokemon].sort((a, b) => a[0]!.localeCompare(b[0]!))
    expect(pairs).toEqual([
      ['AlphaOne', 'AlphaTwo'],
      ['BetaOne', 'BetaTwo'],
    ])
  }, 30_000)

  it('throws for unknown pokemon names', async () => {
    await expect(solve(['FakeMon'], { small: 1, medium: 0, large: 0 }, testData)).rejects.toThrow(
      'Unknown pokemon: FakeMon',
    )
  })
})
