import { usePlacementStore } from '@/stores/placements'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

describe('placements store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('set() records a name against a house id', () => {
    const store = usePlacementStore()
    store.set('AlphaTwo', 'M1')
    expect(store.placements.get('AlphaTwo')).toBe('M1')
  })

  it('set() records a name against null (unhoused)', () => {
    const store = usePlacementStore()
    store.set('AlphaOne', null)
    expect(store.placements.get('AlphaOne')).toBeNull()
    expect(store.placements.has('AlphaOne')).toBe(true)
  })

  it('moving a name between houses keeps exactly one entry', () => {
    const store = usePlacementStore()
    store.set('AlphaTwo', 'M1')
    store.set('AlphaTwo', 'S1')
    expect(store.placements.size).toBe(1)
    expect(store.placements.get('AlphaTwo')).toBe('S1')
  })

  it('clear() empties the map', () => {
    const store = usePlacementStore()
    store.set('AlphaTwo', 'M1')
    store.set('AlphaOne', null)
    store.clear()
    expect(store.placements.size).toBe(0)
  })

  it('remove() deletes a single entry', () => {
    const store = usePlacementStore()
    store.set('AlphaTwo', 'M1')
    store.set('AlphaOne', null)
    store.remove('AlphaTwo')
    expect(store.placements.has('AlphaTwo')).toBe(false)
    expect(store.placements.has('AlphaOne')).toBe(true)
  })
})
