import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useCartStore } from '@/stores/cart'
import {
  getAggregatedIngredients,
  getItemMetadata,
  getItemPicturePath,
  getRecipeForItem,
  type RecipeIngredient,
} from '@/queries'

vi.mock('@/queries', () => ({
  getAggregatedIngredients: vi.fn<typeof getAggregatedIngredients>(),
  getItemMetadata: vi.fn<typeof getItemMetadata>(),
  getItemPicturePath: vi.fn<typeof getItemPicturePath>(),
  getRecipeForItem: vi.fn<typeof getRecipeForItem>(),
}))

const MOCK_METADATA = {
  isCraftable: true,
  category: 'Outdoor',
  flavorText: 'A paddle, bucket and rope is all you need.',
  tag: 'Toy',
}

const CANOE_RECIPE: RecipeIngredient[] = [
  { ingredientName: 'Lumber', ingredientPicture: 'images/lumber.png', count: 2 },
]

describe('cart store recipe display', () => {
  function setup() {
    setActivePinia(createPinia())
    vi.mocked(getItemMetadata).mockResolvedValue(MOCK_METADATA)
    vi.mocked(getItemPicturePath).mockResolvedValue('images/canoe.png')
    vi.mocked(getAggregatedIngredients).mockResolvedValue([])
    return useCartStore()
  }

  it('reflects a recipe that resolves after the item is added', async () => {
    const cart = setup()

    // Simulate the real async timing: getRecipeForItem resolves AFTER the item
    // has already been stored in the cart (matching how the real db query is
    // awaited before recipes.value is populated).
    let resolveRecipe!: (v: RecipeIngredient[]) => void
    vi.mocked(getRecipeForItem).mockReturnValue(
      new Promise((res) => {
        resolveRecipe = res
      }),
    )

    const addPromise = cart.addItem('S1', 'Canoe')

    // Wait until the item is stored in the cart, while the recipe fetch is
    // still pending (recipes.value is not yet populated). At this point the
    // cached per-house array holds an empty recipe.
    await vi.waitFor(() => {
      expect(cart.items.has('S1:Canoe')).toBe(true)
    })
    const pendingItems = cart.itemsByHouse.get('S1') ?? []
    expect(pendingItems[0]!.recipe).toEqual([])

    // The recipe then resolves.
    resolveRecipe(CANOE_RECIPE)
    await addPromise
    await nextTick()

    // The recipe must be reflected once it is available.
    const settled = cart.itemsByHouse.get('S1') ?? []
    expect(settled[0]!.recipe).toEqual(CANOE_RECIPE)
  })
})
