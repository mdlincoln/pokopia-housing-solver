import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useProgressStore = defineStore('progress', () => {
  const checkedHouses = ref(new Set<number>())
  const checkedPokemon = ref(new Set<string>())
  const checkedCartItems = ref(new Set<string>())

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

  function toggleCartItem(houseIndex: number, name: string) {
    const key = `${houseIndex}:${name}`
    if (checkedCartItems.value.has(key)) {
      checkedCartItems.value.delete(key)
    } else {
      checkedCartItems.value.add(key)
    }
  }

  function isCartItemChecked(houseIndex: number, name: string): boolean {
    return checkedCartItems.value.has(`${houseIndex}:${name}`)
  }

  function restoreProgress(data: {
    checkedHouses?: number[]
    checkedPokemon?: string[]
    checkedCartItems?: string[]
  }) {
    checkedHouses.value = new Set(data.checkedHouses ?? [])
    checkedPokemon.value = new Set(data.checkedPokemon ?? [])
    checkedCartItems.value = new Set(data.checkedCartItems ?? [])
  }

  function toSerializable() {
    return {
      checkedHouses: Array.from(checkedHouses.value),
      checkedPokemon: Array.from(checkedPokemon.value),
      checkedCartItems: Array.from(checkedCartItems.value),
    }
  }

  return {
    checkedHouses,
    checkedPokemon,
    checkedCartItems,
    toggleHouse,
    togglePokemon,
    toggleCartItem,
    isHouseChecked,
    isPokemonChecked,
    isCartItemChecked,
    restoreProgress,
    toSerializable,
  }
})
