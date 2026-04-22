import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useProgressStore = defineStore('progress', () => {
  const checkedCartItems = ref(new Set<string>())
  const placedItems = ref(new Set<string>())

  function toggleCartItem(houseId: string, name: string) {
    const key = `${houseId}:${name}`
    if (checkedCartItems.value.has(key)) {
      checkedCartItems.value.delete(key)
    } else {
      checkedCartItems.value.add(key)
    }
  }

  function isCartItemChecked(houseId: string, name: string): boolean {
    return checkedCartItems.value.has(`${houseId}:${name}`)
  }

  function togglePlacedItem(houseId: string, name: string) {
    const key = `${houseId}:${name}`
    if (placedItems.value.has(key)) {
      placedItems.value.delete(key)
    } else {
      placedItems.value.add(key)
    }
  }

  function isItemPlaced(houseId: string, name: string): boolean {
    return placedItems.value.has(`${houseId}:${name}`)
  }

  function clearItemProgress(houseId: string, name: string) {
    const key = `${houseId}:${name}`
    checkedCartItems.value.delete(key)
    placedItems.value.delete(key)
  }

  function restoreProgress(data: { checkedCartItems?: string[]; placedItems?: string[] }) {
    checkedCartItems.value = new Set(data.checkedCartItems ?? [])
    placedItems.value = new Set(data.placedItems ?? [])
  }

  function toSerializable() {
    return {
      checkedCartItems: Array.from(checkedCartItems.value),
      placedItems: Array.from(placedItems.value),
    }
  }

  return {
    checkedCartItems,
    placedItems,
    toggleCartItem,
    isCartItemChecked,
    togglePlacedItem,
    isItemPlaced,
    clearItemProgress,
    restoreProgress,
    toSerializable,
  }
})
