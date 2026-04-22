import {
  getAggregatedIngredients,
  getItemMetadata,
  getItemPicturePath,
  getRecipeForItem,
  type AggregatedIngredient,
  type RecipeIngredient,
} from '@/queries'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useProgressStore } from '@/stores/progress'

interface CartEntry {
  houseId: string
  picturePath: string | null
  isCraftable: boolean
  category: string | null
  flavorText: string | null
  tag: string | null
}

export interface CartItem {
  houseId: string
  name: string
  picturePath: string | null
  recipe: RecipeIngredient[]
  isCraftable: boolean
  category: string | null
  flavorText: string | null
  tag: string | null
}

function cartKey(houseId: string, name: string) {
  return `${houseId}:${name}`
}

export const useCartStore = defineStore('cart', () => {
  const progressStore = useProgressStore()

  const items = ref(new Map<string, CartEntry>())
  const recipes = ref(new Map<string, RecipeIngredient[]>())
  const aggregated = ref<AggregatedIngredient[]>([])
  const totalItems = computed(() => items.value.size)

  const itemList = computed<CartItem[]>(() =>
    Array.from(items.value.entries()).map(([key, entry]) => ({
      houseId: entry.houseId,
      name: key.slice(key.indexOf(':') + 1),
      picturePath: entry.picturePath,
      recipe: recipes.value.get(key.slice(key.indexOf(':') + 1)) ?? [],
      isCraftable: entry.isCraftable,
      category: entry.category,
      flavorText: entry.flavorText,
      tag: entry.tag,
    })),
  )

  // Stable per-house array cache: keyed by houseId → { fingerprint, items }.
  // The fingerprint is "name,..." — cheap to compute and sufficient to detect
  // any change that would alter CartItem field values. When the fingerprint matches,
  // the same CartItem[] reference is returned so watchers in unaffected house cards
  // skip their deep comparison entirely.
  const _stableHouseArrays = new Map<string, { fingerprint: string; items: CartItem[] }>()

  const itemsByHouse = computed(() => {
    const grouped = new Map<string, CartItem[]>()
    for (const item of itemList.value) {
      let list = grouped.get(item.houseId)
      if (!list) {
        list = []
        grouped.set(item.houseId, list)
      }
      list.push(item)
    }

    const result = new Map<string, CartItem[]>()
    for (const [houseId, newItems] of grouped) {
      const fingerprint = newItems.map((i) => i.name).join(',')
      const stable = _stableHouseArrays.get(houseId)
      if (stable?.fingerprint === fingerprint) {
        result.set(houseId, stable.items)
      } else {
        _stableHouseArrays.set(houseId, { fingerprint, items: newItems })
        result.set(houseId, newItems)
      }
    }
    for (const houseId of _stableHouseArrays.keys()) {
      if (!grouped.has(houseId)) _stableHouseArrays.delete(houseId)
    }
    return result
  })

  async function recomputeAggregated() {
    const checked = progressStore.checkedCartItems
    const entries = Array.from(items.value.entries())
      .filter(([key]) => !checked.has(key))
      .map(([key]) => ({
        name: key.slice(key.indexOf(':') + 1),
        quantity: 1,
      }))
    aggregated.value = await getAggregatedIngredients(entries)
  }

  watch(
    () => progressStore.checkedCartItems,
    () => {
      recomputeAggregated()
    },
    { deep: true },
  )

  async function addItem(houseId: string, name: string) {
    const key = cartKey(houseId, name)
    if (items.value.has(key)) return
    const [picturePath, metadata] = await Promise.all([
      getItemPicturePath(name),
      getItemMetadata(name),
    ])
    items.value.set(key, {
      houseId,
      picturePath,
      isCraftable: metadata.isCraftable,
      category: metadata.category,
      flavorText: metadata.flavorText,
      tag: metadata.tag,
    })
    if (!recipes.value.has(name)) {
      recipes.value.set(name, await getRecipeForItem(name))
    }
    await recomputeAggregated()
  }

  async function restoreItems(
    entries: Array<{ houseId?: string; houseIndex?: number; name: string; quantity?: number }>,
  ) {
    items.value.clear()
    recipes.value.clear()

    if (entries.length === 0) {
      aggregated.value = []
      return
    }

    const results = await Promise.all(
      entries.map(async ({ houseId, houseIndex, name }) => {
        const id = houseId ?? String(houseIndex ?? 0)
        const [picturePath, metadata, recipe] = await Promise.all([
          getItemPicturePath(name),
          getItemMetadata(name),
          getRecipeForItem(name),
        ])
        return { houseId: id, name, picturePath, metadata, recipe }
      }),
    )

    for (const { houseId, name, picturePath, metadata, recipe } of results) {
      items.value.set(cartKey(houseId, name), {
        houseId,
        picturePath,
        isCraftable: metadata.isCraftable,
        category: metadata.category,
        flavorText: metadata.flavorText,
        tag: metadata.tag,
      })
      recipes.value.set(name, recipe)
    }

    await recomputeAggregated()
  }

  function removeItem(houseId: string, name: string) {
    items.value.delete(cartKey(houseId, name))
    progressStore.clearItemProgress(houseId, name)
    recomputeAggregated()
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
    clearCart,
  }
})
