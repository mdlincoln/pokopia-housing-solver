import { describe, expect, it } from 'vitest'
import {
  agglomerativeCluster4,
  buildSubMatrix,
  clusterPreAssign,
  greedyMaxWeightMatching,
  type AdjacencyData,
} from '../heuristic'
import { enumerateHouses } from '../solver'

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
// Cluster1: E,F,G,H form a tight clique (weight 5 between all pairs)
// Cluster2: I,J are connected (weight 3)
// Cross-cluster connections are weak (weight 1)
const clusterFixture: AdjacencyData = {
  pokemon: ['E', 'F', 'G', 'H', 'I', 'J'],
  matrix: [
    //  E  F  G  H  I  J
    [0, 5, 5, 5, 1, 0], // E
    [5, 0, 5, 5, 0, 1], // F
    [5, 5, 0, 5, 1, 0], // G
    [5, 5, 5, 0, 0, 1], // H
    [1, 0, 1, 0, 0, 3], // I
    [0, 1, 0, 1, 3, 0], // J
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
