import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useProgressStore = defineStore('progress', () => {
  const checkedCartItems = ref(new Set<string>())

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

  function restoreProgress(data: { checkedCartItems?: string[] }) {
    checkedCartItems.value = new Set(data.checkedCartItems ?? [])
  }

  function toSerializable() {
    return {
      checkedCartItems: Array.from(checkedCartItems.value),
    }
  }

  return {
    checkedCartItems,
    toggleCartItem,
    isCartItemChecked,
    restoreProgress,
    toSerializable,
  }
})
