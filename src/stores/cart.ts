import {
  getAggregatedIngredients,
  getItemMetadata,
  getItemPicturePath,
  getRecipeForItem,
  type AggregatedIngredient,
  type RecipeIngredient,
} from '@/queries'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

interface CartEntry {
  houseIndex: number
  quantity: number
  picturePath: string | null
  isCraftable: boolean
  category: string | null
  flavorText: string | null
}

export interface CartItem {
  houseIndex: number
  name: string
  quantity: number
  picturePath: string | null
  recipe: RecipeIngredient[]
  isCraftable: boolean
  category: string | null
  flavorText: string | null
}

function cartKey(houseIndex: number, name: string) {
  return `${houseIndex}:${name}`
}

export const useCartStore = defineStore('cart', () => {
  const items = ref(new Map<string, CartEntry>())
  const recipes = ref(new Map<string, RecipeIngredient[]>())
  const aggregated = ref<AggregatedIngredient[]>([])
  const totalItems = computed(() => {
    let sum = 0
    for (const entry of items.value.values()) sum += entry.quantity
    return sum
  })

  const itemList = computed<CartItem[]>(() =>
    Array.from(items.value.entries()).map(([key, entry]) => ({
      houseIndex: entry.houseIndex,
      name: key.slice(key.indexOf(':') + 1),
      quantity: entry.quantity,
      picturePath: entry.picturePath,
      recipe: recipes.value.get(key.slice(key.indexOf(':') + 1)) ?? [],
      isCraftable: entry.isCraftable,
      category: entry.category,
      flavorText: entry.flavorText,
    })),
  )

  const itemsByHouse = computed(() => {
    const grouped = new Map<number, CartItem[]>()
    for (const item of itemList.value) {
      let list = grouped.get(item.houseIndex)
      if (!list) {
        list = []
        grouped.set(item.houseIndex, list)
      }
      list.push(item)
    }
    return grouped
  })

  async function recomputeAggregated() {
    const entries = Array.from(items.value.entries()).map(([key, entry]) => ({
      name: key.slice(key.indexOf(':') + 1),
      quantity: entry.quantity,
    }))
    aggregated.value = await getAggregatedIngredients(entries)
  }

  async function addItem(houseIndex: number, name: string) {
    const key = cartKey(houseIndex, name)
    const existing = items.value.get(key)
    if (existing) {
      existing.quantity++
    } else {
      const [picturePath, metadata] = await Promise.all([
        getItemPicturePath(name),
        getItemMetadata(name),
      ])
      items.value.set(key, {
        houseIndex,
        quantity: 1,
        picturePath,
        isCraftable: metadata.isCraftable,
        category: metadata.category,
        flavorText: metadata.flavorText,
      })
      if (!recipes.value.has(name)) {
        recipes.value.set(name, await getRecipeForItem(name))
      }
    }
    await recomputeAggregated()
  }

  async function restoreItems(
    entries: Array<{ houseIndex?: number; name: string; quantity: number }>,
  ) {
    items.value.clear()
    recipes.value.clear()

    if (entries.length === 0) {
      aggregated.value = []
      return
    }

    const results = await Promise.all(
      entries.map(async ({ houseIndex, name, quantity }) => {
        const hi = houseIndex ?? 0
        const [picturePath, metadata, recipe] = await Promise.all([
          getItemPicturePath(name),
          getItemMetadata(name),
          getRecipeForItem(name),
        ])
        return { houseIndex: hi, name, quantity, picturePath, metadata, recipe }
      }),
    )

    for (const { houseIndex, name, quantity, picturePath, metadata, recipe } of results) {
      items.value.set(cartKey(houseIndex, name), {
        houseIndex,
        quantity,
        picturePath,
        isCraftable: metadata.isCraftable,
        category: metadata.category,
        flavorText: metadata.flavorText,
      })
      recipes.value.set(name, recipe)
    }

    await recomputeAggregated()
  }

  function removeItem(houseIndex: number, name: string) {
    items.value.delete(cartKey(houseIndex, name))
    recomputeAggregated()
  }

  async function incrementItem(houseIndex: number, name: string) {
    const entry = items.value.get(cartKey(houseIndex, name))
    if (entry) {
      entry.quantity++
      await recomputeAggregated()
    }
  }

  async function decrementItem(houseIndex: number, name: string) {
    const key = cartKey(houseIndex, name)
    const entry = items.value.get(key)
    if (!entry) return
    entry.quantity--
    if (entry.quantity <= 0) {
      items.value.delete(key)
    }
    await recomputeAggregated()
  }

  function clearCart() {
    items.value.clear()
    aggregated.value = []
  }

  return {
    items,
    recipes,
    aggregated,
    totalItems,
    itemList,
    itemsByHouse,
    addItem,
    restoreItems,
    removeItem,
    incrementItem,
    decrementItem,
    clearCart,
  }
})
