// HouseRecommendations analytics: AC.7 — "Show 50 more" fires
// recommendations_expanded with the post-increment visible_count. The spec
// stubs the two async query helpers (recommendedItemsForHouseAllNeeds resolves
// 60 items so the 50-row window has a "Show 50 more" row) and everything else
// stays real, mirroring HouseRecord.spec's importOriginal pattern.
//
// Filename note: the plan names this file `HouseRecommendations.spec.ts`, but
// that string collides case-insensitively with the pre-existing pure-helper
// spec `src/__tests__/houseRecommendations.spec.ts` on macOS's default
// filesystem, so this component test lives under a distinct name.

import HouseRecommendations from '@/components/HouseRecommendations.vue'
import {
  favoritesForItems,
  recommendedItemsForHouseAllNeeds,
  type RecommendedHouseItem,
} from '@/queries'
import type { HouseAssignment, PokemonData } from '@/solver'
import posthog from 'posthog-js'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/queries', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    favoritesForItems: vi.fn<typeof favoritesForItems>(),
    recommendedItemsForHouseAllNeeds: vi.fn<typeof recommendedItemsForHouseAllNeeds>(),
  }
})

// RecommendedHouseItem extends ItemDetails (the six fields below) with a
// fav_<favorite> string/boolean/null index signature — sufficient for
// buildRecommendationRows to produce renderable rows.
function makeItems(count: number): RecommendedHouseItem[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `item-${i}`,
    isCraftable: true,
    category: 'Toy',
    flavorText: null,
    picturePath: null,
    tag: 'Toy',
  }))
}

const house: HouseAssignment = {
  houseId: 'S1',
  size: 'small',
  capacity: 1,
  pokemon: ['AlphaOne'],
}

const pokemonData: PokemonData = {
  AlphaOne: { image: '', favorites: ['A'], habitat: 'Dark' },
}

function mountRecs() {
  return mount(HouseRecommendations, {
    props: {
      house,
      pokemonData,
      houseCartItems: [],
      fulfilledFavorites: new Set<string>(),
    },
    global: { plugins: [createPinia()] },
  })
}

describe('HouseRecommendations analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(recommendedItemsForHouseAllNeeds).mockResolvedValue(makeItems(60))
    vi.mocked(favoritesForItems).mockImplementation(async (names: string[]) => {
      return new Map(names.map((n) => [n, ['Toy']] as const))
    })
  })

  it('clicks "Show 50 more" and tracks recommendations_expanded with the post-increment visible_count', async () => {
    const wrapper = mountRecs()
    await flushPromises()

    // Open the collapsible panel so the lazy BTable (and its custom foot with
    // the "Show 50 more" row) mounts. 60 recommendations > the 50-row window.
    const details = wrapper.find('[data-testid="recommended-items"]')
    expect(details.exists()).toBe(true)
    ;(details.element as HTMLDetailsElement).open = true
    await details.trigger('toggle')
    await flushPromises()

    const moreButton = wrapper.find('[data-testid="recommendations-more"]')
    expect(moreButton.exists()).toBe(true)

    await moreButton.trigger('click')
    await flushPromises()

    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('recommendations_expanded', {
      house_id: 'S1',
      visible_count: 100,
    })
  })
})
