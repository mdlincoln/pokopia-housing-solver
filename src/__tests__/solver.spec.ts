import { describe, expect, it } from 'vitest'
import {
  agglomerativeCluster4,
  buildSubMatrix,
  clusterPreAssign,
  countSharedFavorites,
  enumerateHouses,
  greedyMaxWeightMatching,
  solve,
  type AdjacencyData,
  type PokemonData,
} from '../solver'

// Simple 4-pokemon adjacency fixture
// A-B: 4, A-C: 1, A-D: 0
// B-C: 1, B-D: 0
// C-D: 3
const fixture: AdjacencyData = {
  pokemon: ['A', 'B', 'C', 'D'],
  matrix: [
    [0, 4, 1, 0],
    [4, 0, 1, 0],
    [1, 1, 0, 3],
    [0, 0, 3, 0],
  ],
}

describe('buildSubMatrix', () => {
  it('returns exact matrix when all pokemon are included', () => {
    const result = buildSubMatrix(['A', 'B', 'C', 'D'], fixture)
    expect(result).toEqual(fixture.matrix)
  })

  it('returns correct sub-matrix for a subset', () => {
    // Sub-matrix for [A, B]: only A-B connection = 4
    const result = buildSubMatrix(['A', 'B'], fixture)
    expect(result).toEqual([
      [0, 4],
      [4, 0],
    ])
  })

  it('is symmetric', () => {
    const result = buildSubMatrix(['A', 'C', 'D'], fixture)
    for (let i = 0; i < result.length; i++) {
      for (let j = 0; j < result.length; j++) {
        expect(result[i]![j]).toBe(result[j]![i])
      }
    }
  })

  it('uses 0 for pokemon not found in adjacency data', () => {
    const result = buildSubMatrix(['A', 'Unknown'], fixture)
    expect(result).toEqual([
      [0, 0],
      [0, 0],
    ])
  })
})

// 6-pokemon fixture for clustering tests
// Cluster1: E,F,G,H form a tight clique (weight 5 between all pairs), habitat: Cool
// Cluster2: I,J are connected (weight 3), habitat: Warm
// Cross-cluster connections are null (habitat-incompatible: Cool ↔ Warm)
const clusterFixture: AdjacencyData = {
  pokemon: ['E', 'F', 'G', 'H', 'I', 'J'],
  matrix: [
    //     E     F     G     H     I     J
    [0, 5, 5, 5, null, null], // E (Cool)
    [5, 0, 5, 5, null, null], // F (Cool)
    [5, 5, 0, 5, null, null], // G (Cool)
    [5, 5, 5, 0, null, null], // H (Cool)
    [null, null, null, null, 0, 3], // I (Warm)
    [null, null, null, null, 3, 0], // J (Warm)
  ],
}

describe('agglomerativeCluster4', () => {
  it('finds the obvious 4-clique', () => {
    const subMatrix = buildSubMatrix(['E', 'F', 'G', 'H', 'I', 'J'], clusterFixture)
    const available = new Set([0, 1, 2, 3, 4, 5])
    const clusters = agglomerativeCluster4(available, subMatrix, 1)

    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.sort()).toEqual([0, 1, 2, 3]) // E, F, G, H
  })

  it('returns empty when count is 0', () => {
    const subMatrix = buildSubMatrix(['E', 'F'], clusterFixture)
    const clusters = agglomerativeCluster4(new Set([0, 1]), subMatrix, 0)
    expect(clusters).toEqual([])
  })

  it('returns empty when fewer than 4 nodes available', () => {
    const subMatrix = buildSubMatrix(['E', 'F', 'G'], clusterFixture)
    const clusters = agglomerativeCluster4(new Set([0, 1, 2]), subMatrix, 1)
    expect(clusters).toEqual([])
  })

  it('does not mutate the available set', () => {
    const subMatrix = buildSubMatrix(['E', 'F', 'G', 'H', 'I', 'J'], clusterFixture)
    const available = new Set([0, 1, 2, 3, 4, 5])
    agglomerativeCluster4(available, subMatrix, 1)
    expect(available.size).toBe(6)
  })
})

describe('greedyMaxWeightMatching', () => {
  it('matches the highest-weight pair first', () => {
    const subMatrix = buildSubMatrix(['A', 'B', 'C', 'D'], fixture)
    const pairs = greedyMaxWeightMatching(new Set([0, 1, 2, 3]), subMatrix, 1)

    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.sort()).toEqual([0, 1]) // A-B with weight 4
  })

  it('finds two non-overlapping pairs', () => {
    const subMatrix = buildSubMatrix(['A', 'B', 'C', 'D'], fixture)
    const pairs = greedyMaxWeightMatching(new Set([0, 1, 2, 3]), subMatrix, 2)

    expect(pairs).toHaveLength(2)
    expect(pairs[0]!.sort()).toEqual([0, 1]) // A-B (weight 4)
    expect(pairs[1]!.sort()).toEqual([2, 3]) // C-D (weight 3)
  })

  it('returns empty when count is 0', () => {
    const subMatrix = buildSubMatrix(['A', 'B'], fixture)
    const pairs = greedyMaxWeightMatching(new Set([0, 1]), subMatrix, 0)
    expect(pairs).toEqual([])
  })

  it('returns empty when fewer than 2 nodes', () => {
    const subMatrix = buildSubMatrix(['A'], fixture)
    const pairs = greedyMaxWeightMatching(new Set([0]), subMatrix, 1)
    expect(pairs).toEqual([])
  })
})

describe('clusterPreAssign', () => {
  it('fills a large house with a 4-cluster and a medium house with a pair', () => {
    const names = ['E', 'F', 'G', 'H', 'I', 'J']
    const houses = enumerateHouses({ small: 0, medium: 1, large: 1 })
    const subMatrix = buildSubMatrix(names, clusterFixture)
    const result = clusterPreAssign(names, houses, subMatrix)

    // All 6 should be assigned
    expect(result.size).toBe(6)

    // E,F,G,H should share a large house
    const efghHouse = result.get('E')!
    expect(result.get('F')).toBe(efghHouse)
    expect(result.get('G')).toBe(efghHouse)
    expect(result.get('H')).toBe(efghHouse)

    // I,J should share a medium house
    const ijHouse = result.get('I')!
    expect(result.get('J')).toBe(ijHouse)
    expect(ijHouse).not.toBe(efghHouse)
  })

  it('skips small houses', () => {
    const names = ['A', 'B', 'C', 'D']
    const houses = enumerateHouses({ small: 4, medium: 0, large: 0 })
    const subMatrix = buildSubMatrix(names, fixture)
    const result = clusterPreAssign(names, houses, subMatrix)
    expect(result.size).toBe(0)
  })

  it('handles only medium houses', () => {
    const names = ['A', 'B', 'C', 'D']
    const houses = enumerateHouses({ small: 0, medium: 2, large: 0 })
    const subMatrix = buildSubMatrix(names, fixture)
    const result = clusterPreAssign(names, houses, subMatrix)

    expect(result.size).toBe(4)
    expect(result.get('A')).toBe(result.get('B'))
    expect(result.get('C')).toBe(result.get('D'))
  })
})

const testData: PokemonData = {
  AlphaOne: { image: '', favorites: ['A', 'B', 'C', 'D', 'E'], habitat: 'Cool' },
  AlphaTwo: { image: '', favorites: ['A', 'B', 'C', 'D', 'F'], habitat: 'Cool' }, // 4 shared with AlphaOne
  BetaOne: { image: '', favorites: ['X', 'Y', 'Z', 'W', 'V'], habitat: 'Dry' }, // 0 shared with Alphas
  BetaTwo: { image: '', favorites: ['X', 'Y', 'Z', 'W', 'U'], habitat: 'Dry' }, // 4 shared with BetaOne
  Loner: { image: '', favorites: ['Q', 'R', 'S', 'T', 'P'] }, // 0 shared with anyone, no habitat
  ClashCool: { image: '', favorites: ['A', 'B', 'C', 'D', 'E'], habitat: 'Cool' },
  ClashWarm: { image: '', favorites: ['A', 'B', 'C', 'D', 'E'], habitat: 'Warm' }, // opposite Cool on temperature axis
  NeutralDark: { image: '', favorites: ['A', 'B', 'C', 'D', 'E'], habitat: 'Dark' }, // different axis, no conflict
}

// Explicit adjacency fixture matching testData order.
// Includes habitat effects: same-habitat bonus (+1), opposite-axis exclusions (null).
const testDataFixture: AdjacencyData = {
  pokemon: [
    'AlphaOne',
    'AlphaTwo',
    'BetaOne',
    'BetaTwo',
    'Loner',
    'ClashCool',
    'ClashWarm',
    'NeutralDark',
  ],
  matrix: [
    // AlphaOne  AlphaTwo BetaOne BetaTwo Loner ClashCool ClashWarm NeutralDark
    [0, 5, 0, 0, 0, 6, null, 5],
    [5, 0, 0, 0, 0, 5, null, 4],
    [0, 0, 0, 5, 0, 0, 0, 0],
    [0, 0, 5, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [6, 5, 0, 0, 0, 0, null, 5],
    [null, null, 0, 0, 0, null, 0, 5],
    [5, 4, 0, 0, 0, 5, 5, 0],
  ],
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
    const result = await solve(
      ['AlphaOne'],
      { small: 1, medium: 0, large: 0 },
      testData,
      testDataFixture,
    )
    expect(result.unhoused).toEqual([])
    expect(result.houses[0]!.pokemon).toEqual(['AlphaOne'])
  }, 30_000)

  it('leaves one unhoused when capacity is exceeded', async () => {
    const result = await solve(
      ['AlphaOne', 'AlphaTwo'],
      { small: 1, medium: 0, large: 0 },
      testData,
      testDataFixture,
    )
    expect(result.houses[0]!.pokemon).toHaveLength(1)
    expect(result.unhoused).toHaveLength(1)
  }, 30_000)

  it('returns empty result for no pokemon', async () => {
    const result = await solve([], { small: 1, medium: 0, large: 0 }, testData, testDataFixture)
    expect(result.unhoused).toEqual([])
    expect(result.houses[0]!.pokemon).toEqual([])
  })

  it('marks all unhoused when no houses exist', async () => {
    const result = await solve(
      ['AlphaOne', 'AlphaTwo'],
      { small: 0, medium: 0, large: 0 },
      testData,
      testDataFixture,
    )
    expect(result.houses).toEqual([])
    expect(result.unhoused).toHaveLength(2)
  })

  it('fits all pokemon when capacity is sufficient', async () => {
    const result = await solve(
      ['AlphaOne', 'AlphaTwo', 'BetaOne'],
      { small: 0, medium: 0, large: 1 },
      testData,
      testDataFixture,
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
      testDataFixture,
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
      testDataFixture,
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
    await expect(
      solve(['FakeMon'], { small: 1, medium: 0, large: 0 }, testData, testDataFixture),
    ).rejects.toThrow('Unknown pokemon: FakeMon')
  })
})

describe('habitat incompatibility', () => {
  it('prevents opposite-habitat pokemon from sharing a medium house', async () => {
    const result = await solve(
      ['ClashCool', 'ClashWarm'],
      { small: 0, medium: 1, large: 0 },
      testData,
      testDataFixture,
    )

    // They share 5 favorites but are habitat-incompatible — only one can be housed
    expect(result.houses[0]!.pokemon).toHaveLength(1)
    expect(result.unhoused).toHaveLength(1)
  }, 30_000)

  it('places opposite-habitat pokemon in separate small houses', async () => {
    const result = await solve(
      ['ClashCool', 'ClashWarm'],
      { small: 2, medium: 0, large: 0 },
      testData,
      testDataFixture,
    )

    expect(result.unhoused).toEqual([])
    expect(result.houses[0]!.pokemon).toHaveLength(1)
    expect(result.houses[1]!.pokemon).toHaveLength(1)
  }, 30_000)

  it('excludes opposite-habitat pokemon from same large house', async () => {
    // ClashCool + NeutralDark are compatible; ClashWarm opposes ClashCool
    const result = await solve(
      ['ClashCool', 'ClashWarm', 'NeutralDark'],
      { small: 0, medium: 0, large: 1 },
      testData,
      testDataFixture,
    )

    // Large house seats 4, but ClashCool and ClashWarm can't cohabit
    const housed = result.houses[0]!.pokemon
    expect(housed).toHaveLength(2)
    expect(result.unhoused).toHaveLength(1)
    // The two that ARE housed must not be the incompatible pair
    expect(housed).not.toEqual(expect.arrayContaining(['ClashCool', 'ClashWarm']))
  }, 30_000)

  it('allows different-axis habitats to share a house', async () => {
    // Cool ↔ Dark are on different axes — no conflict
    const result = await solve(
      ['ClashCool', 'NeutralDark'],
      { small: 0, medium: 1, large: 0 },
      testData,
      testDataFixture,
    )

    expect(result.unhoused).toEqual([])
    expect(result.houses[0]!.pokemon.sort()).toEqual(['ClashCool', 'NeutralDark'])
  }, 30_000)

  it('prevents clustering of opposite-habitat pokemon into a medium house', async () => {
    // 1 Cool pokemon + 1 Warm: the Warm one has identical favorites to the Cool one
    // but must not be clustered with them in a house
    const result = await solve(
      ['ClashCool', 'ClashWarm'],
      { small: 1, medium: 1, large: 0 },
      testData,
      testDataFixture,
    )

    // Find the medium house
    const mediumHouse = result.houses.find((h) => h.size === 'medium')!
    // ClashWarm must not be in the same house as any Cool pokemon.
    const warmInMedium = mediumHouse.pokemon.includes('ClashWarm')
    const coolInMedium = ['ClashCool', 'AlphaOne', 'AlphaTwo'].some((name) =>
      mediumHouse.pokemon.includes(name),
    )
    expect(warmInMedium && coolInMedium).toBe(false)
  }, 30_000)

  it('prevents clustering of opposite-habitat pokemon into a large house', async () => {
    // 4 Cool pokemon + 1 Warm: the Warm one has identical favorites to the Cool ones
    // but must not be clustered with them in a large house
    const result = await solve(
      ['AlphaOne', 'AlphaTwo', 'ClashCool', 'ClashWarm', 'NeutralDark'],
      { small: 1, medium: 0, large: 1 },
      testData,
      testDataFixture,
    )

    // Find the large house
    const largeHouse = result.houses.find((h) => h.size === 'large')!
    // ClashWarm must not be in the same house as any Cool pokemon.
    const warmInLarge = largeHouse.pokemon.includes('ClashWarm')
    const coolInLarge = ['ClashCool', 'AlphaOne', 'AlphaTwo'].some((name) =>
      largeHouse.pokemon.includes(name),
    )
    expect(warmInLarge && coolInLarge).toBe(false)
  }, 30_000)
})
