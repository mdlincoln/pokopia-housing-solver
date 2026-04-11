import type { HouseSize, HousingConfig } from '@/solver'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const SIZE_PREFIX: Record<HouseSize, string> = {
  small: 'S',
  medium: 'M',
  large: 'L',
}

const CAPACITY: Record<HouseSize, number> = {
  small: 1,
  medium: 2,
  large: 4,
}

export interface HouseEntry {
  id: string
  size: HouseSize
  capacity: number
}

export const useHouseStore = defineStore('houses', () => {
  const registry = ref(new Map<string, HouseEntry>())
  const counters = ref<Record<HouseSize, number>>({ small: 0, medium: 0, large: 0 })

  function makeId(size: HouseSize): string {
    counters.value[size]++
    return `${SIZE_PREFIX[size]}${counters.value[size]}`
  }

  function reconcileHouses(config: HousingConfig, pinnedHouseIds: Set<string>) {
    for (const size of ['small', 'medium', 'large'] as HouseSize[]) {
      const desired = config[size]
      const current = [...registry.value.values()].filter((h) => h.size === size)
      const currentCount = current.length

      if (currentCount < desired) {
        // Add houses
        for (let i = 0; i < desired - currentCount; i++) {
          const id = makeId(size)
          registry.value.set(id, { id, size, capacity: CAPACITY[size] })
        }
      } else if (currentCount > desired) {
        // Remove unlocked houses, starting from the highest counter (most recent)
        const removable = current
          .filter((h) => !pinnedHouseIds.has(h.id))
          .sort((a, b) => {
            const numA = parseInt(a.id.slice(1))
            const numB = parseInt(b.id.slice(1))
            return numB - numA // highest first
          })

        const toRemove = Math.min(removable.length, currentCount - desired)
        for (let i = 0; i < toRemove; i++) {
          registry.value.delete(removable[i]!.id)
        }
      }
    }
  }

  const orderedHouses = computed<HouseEntry[]>(() => {
    const all = [...registry.value.values()]
    const order: Record<HouseSize, number> = { large: 0, medium: 1, small: 2 }
    return all.sort((a, b) => {
      const sizeOrd = order[a.size] - order[b.size]
      if (sizeOrd !== 0) return sizeOrd
      const numA = parseInt(a.id.slice(1))
      const numB = parseInt(b.id.slice(1))
      return numA - numB
    })
  })

  function lockedCountBySize(pinnedIds: Set<string>): Record<HouseSize, number> {
    const result: Record<HouseSize, number> = { small: 0, medium: 0, large: 0 }
    for (const id of pinnedIds) {
      const entry = registry.value.get(id)
      if (entry) {
        result[entry.size]++
      }
    }
    return result
  }

  function toSerializable() {
    return {
      houseRegistry: [...registry.value.values()].map(({ id, size }) => ({ id, size })),
      houseCounters: { ...counters.value },
    }
  }

  function restoreRegistry(data: {
    houseRegistry?: Array<{ id: string; size: string }>
    houseCounters?: Record<string, number>
  }) {
    registry.value.clear()
    if (data.houseRegistry) {
      for (const { id, size } of data.houseRegistry) {
        const s = size as HouseSize
        registry.value.set(id, { id, size: s, capacity: CAPACITY[s] })
      }
    }
    if (data.houseCounters) {
      counters.value = {
        small: data.houseCounters.small ?? 0,
        medium: data.houseCounters.medium ?? 0,
        large: data.houseCounters.large ?? 0,
      }
    }
  }

  function clear() {
    registry.value.clear()
    counters.value = { small: 0, medium: 0, large: 0 }
  }

  return {
    registry,
    counters,
    reconcileHouses,
    orderedHouses,
    lockedCountBySize,
    toSerializable,
    restoreRegistry,
    clear,
  }
})
