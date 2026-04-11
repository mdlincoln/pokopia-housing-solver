import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useProgressStore = defineStore('progress', () => {
  const checkedHouses = ref(new Set<number>())
  const checkedPokemon = ref(new Set<string>())

  function toggleHouse(houseIndex: number) {
    if (checkedHouses.value.has(houseIndex)) {
      checkedHouses.value.delete(houseIndex)
    } else {
      checkedHouses.value.add(houseIndex)
    }
  }

  function togglePokemon(houseIndex: number, name: string) {
    const key = `${houseIndex}:${name}`
    if (checkedPokemon.value.has(key)) {
      checkedPokemon.value.delete(key)
    } else {
      checkedPokemon.value.add(key)
    }
  }

  function isHouseChecked(houseIndex: number): boolean {
    return checkedHouses.value.has(houseIndex)
  }

  function isPokemonChecked(houseIndex: number, name: string): boolean {
    return checkedPokemon.value.has(`${houseIndex}:${name}`)
  }

  function restoreProgress(data: { checkedHouses?: number[]; checkedPokemon?: string[] }) {
    checkedHouses.value = new Set(data.checkedHouses ?? [])
    checkedPokemon.value = new Set(data.checkedPokemon ?? [])
  }

  function toSerializable() {
    return {
      checkedHouses: Array.from(checkedHouses.value),
      checkedPokemon: Array.from(checkedPokemon.value),
    }
  }

  return {
    checkedHouses,
    checkedPokemon,
    toggleHouse,
    togglePokemon,
    isHouseChecked,
    isPokemonChecked,
    restoreProgress,
    toSerializable,
  }
})
