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
  quantity: number
  picturePath: string | null
  isCraftable: boolean
  category: string | null
  flavorText: string | null
}

export interface CartItem {
  name: string
  quantity: number
  picturePath: string | null
  recipe: RecipeIngredient[]
  isCraftable: boolean
  category: string | null
  flavorText: string | null
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
    Array.from(items.value.entries()).map(([name, entry]) => ({
      name,
      quantity: entry.quantity,
      picturePath: entry.picturePath,
      recipe: recipes.value.get(name) ?? [],
      isCraftable: entry.isCraftable,
      category: entry.category,
      flavorText: entry.flavorText,
    })),
  )

  async function recomputeAggregated() {
    const entries = Array.from(items.value.entries()).map(([name, entry]) => ({
      name,
      quantity: entry.quantity,
    }))
    aggregated.value = await getAggregatedIngredients(entries)
  }

  async function addItem(name: string) {
    const existing = items.value.get(name)
    if (existing) {
      existing.quantity++
    } else {
      const [picturePath, metadata] = await Promise.all([
        getItemPicturePath(name),
        getItemMetadata(name),
      ])
      items.value.set(name, {
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

  async function restoreItems(entries: { name: string; quantity: number }[]) {
    items.value.clear()
    recipes.value.clear()

    if (entries.length === 0) {
      aggregated.value = []
      return
    }

    const results = await Promise.all(
      entries.map(async ({ name, quantity }) => {
        const [picturePath, metadata, recipe] = await Promise.all([
          getItemPicturePath(name),
          getItemMetadata(name),
          getRecipeForItem(name),
        ])
        return { name, quantity, picturePath, metadata, recipe }
      }),
    )

    for (const { name, quantity, picturePath, metadata, recipe } of results) {
      items.value.set(name, {
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

  function removeItem(name: string) {
    items.value.delete(name)
    recomputeAggregated()
  }

  async function incrementItem(name: string) {
    const entry = items.value.get(name)
    if (entry) {
      entry.quantity++
      await recomputeAggregated()
    }
  }

  async function decrementItem(name: string) {
    const entry = items.value.get(name)
    if (!entry) return
    entry.quantity--
    if (entry.quantity <= 0) {
      items.value.delete(name)
    }
    await recomputeAggregated()
  }

  return {
    items,
    recipes,
    aggregated,
    totalItems,
    itemList,
    addItem,
    restoreItems,
    removeItem,
    incrementItem,
    decrementItem,
  }
})
