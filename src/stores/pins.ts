import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const usePinStore = defineStore('pins', () => {
  const pinnedHouses = ref(new Set<string>())
  const pinnedPokemon = ref(new Set<string>())

  function pinHouse(houseId: string, currentOccupants: string[]) {
    pinnedHouses.value.add(houseId)
    for (const name of currentOccupants) {
      pinnedPokemon.value.add(`${houseId}:${name}`)
    }
  }

  function unpinHouse(houseId: string) {
    pinnedHouses.value.delete(houseId)
  }

  function toggleHousePin(houseId: string, currentOccupants: string[]) {
    if (pinnedHouses.value.has(houseId)) {
      unpinHouse(houseId)
    } else {
      pinHouse(houseId, currentOccupants)
    }
  }

  function togglePokemonPin(houseId: string, name: string) {
    const key = `${houseId}:${name}`
    if (pinnedPokemon.value.has(key)) {
      pinnedPokemon.value.delete(key)
    } else {
      pinnedPokemon.value.add(key)
    }
  }

  function isHousePinned(houseId: string): boolean {
    return pinnedHouses.value.has(houseId)
  }

  function isPokemonPinned(houseId: string, name: string): boolean {
    return pinnedPokemon.value.has(`${houseId}:${name}`)
  }

  function getPinnedAssignments(): Map<string, string[]> {
    const result = new Map<string, string[]>()
    for (const key of pinnedPokemon.value) {
      const colonIdx = key.indexOf(':')
      const houseId = key.slice(0, colonIdx)
      const name = key.slice(colonIdx + 1)
      let list = result.get(houseId)
      if (!list) {
        list = []
        result.set(houseId, list)
      }
      list.push(name)
    }
    return result
  }

  const effectivelyPinnedHouseIds = computed<Set<string>>(() => {
    const ids = new Set(pinnedHouses.value)
    for (const key of pinnedPokemon.value) {
      const colonIdx = key.indexOf(':')
      ids.add(key.slice(0, colonIdx))
    }
    return ids
  })

  const allPinnedPokemonNames = computed<Set<string>>(() => {
    const names = new Set<string>()
    for (const key of pinnedPokemon.value) {
      const colonIdx = key.indexOf(':')
      names.add(key.slice(colonIdx + 1))
    }
    return names
  })

  function toSerializable() {
    return {
      pinnedHouses: Array.from(pinnedHouses.value),
      pinnedPokemon: Array.from(pinnedPokemon.value),
    }
  }

  function restorePins(data: { pinnedHouses?: string[]; pinnedPokemon?: string[] }) {
    pinnedHouses.value = new Set(data.pinnedHouses ?? [])
    pinnedPokemon.value = new Set(data.pinnedPokemon ?? [])
  }

  function clear() {
    pinnedHouses.value.clear()
    pinnedPokemon.value.clear()
  }

  return {
    pinnedHouses,
    pinnedPokemon,
    pinHouse,
    unpinHouse,
    toggleHousePin,
    togglePokemonPin,
    isHousePinned,
    isPokemonPinned,
    getPinnedAssignments,
    effectivelyPinnedHouseIds,
    allPinnedPokemonNames,
    toSerializable,
    restorePins,
    clear,
  }
})
