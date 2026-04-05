import { describe, it, expect } from 'vitest'
import { buildSubMatrix, greedyPreAssign, type AdjacencyData } from '../heuristic'
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

describe('greedyPreAssign', () => {
  it('assigns anchor and neighbor to a medium house', () => {
    // A has avg = (4+1+0)/3 = 1.67, B has avg = (4+1+0)/3 = 1.67,
    // C has avg = (1+1+3)/3 = 1.67, D has avg = (0+0+3)/3 = 1.0
    // Tie at top: A (or B) picked first; neighbor = B (4 shared with A)
    const houses = enumerateHouses({ small: 0, medium: 1, large: 0 })
    const subMatrix = buildSubMatrix(['A', 'B', 'C', 'D'], fixture)
    const result = greedyPreAssign(['A', 'B', 'C', 'D'], houses, subMatrix)

    expect(result.size).toBe(2)
    const assigned = [...result.keys()].sort()
    // A and B share 4 — the highest pair — so they should be assigned together
    expect(assigned).toEqual(['A', 'B'])
    expect(result.get('A')).toBe(result.get('B'))
  })

  it('fills two medium houses with the two best pairs', () => {
    // Best pairs: A+B (4 shared) and C+D (3 shared)
    const houses = enumerateHouses({ small: 0, medium: 2, large: 0 })
    const subMatrix = buildSubMatrix(['A', 'B', 'C', 'D'], fixture)
    const result = greedyPreAssign(['A', 'B', 'C', 'D'], houses, subMatrix)

    expect(result.size).toBe(4)
    expect(result.get('A')).toBe(result.get('B'))
    expect(result.get('C')).toBe(result.get('D'))
    expect(result.get('A')).not.toBe(result.get('C'))
  })

  it('skips small houses', () => {
    const houses = enumerateHouses({ small: 2, medium: 0, large: 0 })
    const subMatrix = buildSubMatrix(['A', 'B'], fixture)
    const result = greedyPreAssign(['A', 'B'], houses, subMatrix)
    expect(result.size).toBe(0)
  })

  it('stops early when pool is exhausted', () => {
    // Only 2 pokemon but 3 medium houses
    const houses = enumerateHouses({ small: 0, medium: 3, large: 0 })
    const subMatrix = buildSubMatrix(['A', 'B'], fixture)
    const result = greedyPreAssign(['A', 'B'], houses, subMatrix)
    expect(result.size).toBe(2)
  })

  it('handles empty pokemon list', () => {
    const houses = enumerateHouses({ small: 0, medium: 1, large: 0 })
    const result = greedyPreAssign([], houses, [])
    expect(result.size).toBe(0)
  })
})
