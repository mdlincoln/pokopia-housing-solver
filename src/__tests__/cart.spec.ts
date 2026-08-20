import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useCartStore } from '@/stores/cart'
import {
  getAggregatedIngredients,
  getItemMetadata,
  getItemPicturePath,
  getRecipeForItem,
  type AggregatedIngredient,
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

describe('cart store busy flag', () => {
  function setup() {
    setActivePinia(createPinia())
    vi.mocked(getItemMetadata).mockResolvedValue(MOCK_METADATA)
    vi.mocked(getItemPicturePath).mockResolvedValue('images/canoe.png')
    vi.mocked(getAggregatedIngredients).mockResolvedValue([])
    return useCartStore()
  }

  it('is busy while addItem is in flight and settles after', async () => {
    const cart = setup()
    let resolveRecipe!: (v: RecipeIngredient[]) => void
    vi.mocked(getRecipeForItem).mockReturnValue(
      new Promise((res) => {
        resolveRecipe = res
      }),
    )

    expect(cart.busy).toBe(false)
    const addPromise = cart.addItem('S1', 'Canoe')
    expect(cart.busy).toBe(true)

    resolveRecipe(CANOE_RECIPE)
    await addPromise
    expect(cart.busy).toBe(false)
  })

  it('is busy while removeItem recomputes aggregates and settles after', async () => {
    const cart = setup()
    vi.mocked(getRecipeForItem).mockResolvedValue(CANOE_RECIPE)
    await cart.addItem('S1', 'Canoe')
    expect(cart.busy).toBe(false)

    let resolveAggregated!: (v: AggregatedIngredient[]) => void
    vi.mocked(getAggregatedIngredients).mockReturnValue(
      new Promise((res) => {
        resolveAggregated = res
      }),
    )

    const removePromise = cart.removeItem('S1', 'Canoe')
    expect(cart.busy).toBe(true)

    resolveAggregated([])
    await removePromise
    expect(cart.busy).toBe(false)
  })

  it('is busy while restoreItems with entries is in flight', async () => {
    const cart = setup()
    vi.mocked(getRecipeForItem).mockResolvedValue(CANOE_RECIPE)
    let resolveMetadata!: (v: typeof MOCK_METADATA) => void
    vi.mocked(getItemMetadata).mockReturnValue(
      new Promise((res) => {
        resolveMetadata = res
      }),
    )

    const restorePromise = cart.restoreItems([{ houseId: 'S1', name: 'Canoe' }])
    expect(cart.busy).toBe(true)

    resolveMetadata(MOCK_METADATA)
    await restorePromise
    expect(cart.busy).toBe(false)
  })

  it('reports busy synchronously for mutations with no async work', async () => {
    const cart = setup()

    // clearCart and empty restoreItems complete in a single microtask, so the
    // busy window is only observable before awaiting the returned promise.
    const clearPromise = cart.clearCart()
    expect(cart.busy).toBe(true)
    await clearPromise
    expect(cart.busy).toBe(false)

    const restorePromise = cart.restoreItems([])
    expect(cart.busy).toBe(true)
    await restorePromise
    expect(cart.busy).toBe(false)
  })

  it('stays busy until all concurrent mutations settle', async () => {
    const cart = setup()
    let resolveRecipe1!: (v: RecipeIngredient[]) => void
    let resolveRecipe2!: (v: RecipeIngredient[]) => void
    vi.mocked(getRecipeForItem)
      .mockReturnValueOnce(
        new Promise((res) => {
          resolveRecipe1 = res
        }),
      )
      .mockReturnValueOnce(
        new Promise((res) => {
          resolveRecipe2 = res
        }),
      )

    const add1 = cart.addItem('S1', 'Canoe')
    const add2 = cart.addItem('S1', 'Beach Ball')
    expect(cart.busy).toBe(true)

    resolveRecipe1(CANOE_RECIPE)
    await add1
    expect(cart.busy).toBe(true)

    resolveRecipe2(CANOE_RECIPE)
    await add2
    expect(cart.busy).toBe(false)
  })
})
