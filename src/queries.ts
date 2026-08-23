// Query layer over the build-time baked data (see scripts/build_data.mjs and
// src/data/index.ts). No SQL or WASM runs in the browser: the pokemon catalog
// and item graph are bundled JSON, and the adjacency matrix is a single fetch
// decoded into a flat Int16Array. This module is the only one that reads the
// baked data — never import src/data/* from components or other modules.

import { loadAdjacencyData, loadItemGraphData, loadPokemonCatalog } from '@/data'
import type { AdjacencyData, PokemonData } from '@/solver'

export interface ItemDetails {
  name: string
  isCraftable: boolean
  category: string | null
  flavorText: string | null
  picturePath: string | null
  tag: string | null
}

export interface RecipeIngredient {
  ingredientName: string
  ingredientPicture: string | null
  count: number
}

export interface AggregatedIngredient {
  name: string
  picturePath: string | null
  total: number
}

export interface ItemGraph {
  itemDetailsByName: Map<string, ItemDetails>
  itemsByFavorite: Map<string, ItemDetails[]> // shared ItemDetails refs
  favoritesByItem: Map<string, string[]>
  recipeByItem: Map<string, RecipeIngredient[]>
  itemsByTag: Map<string, ItemDetails[]> // shared ItemDetails refs, keyed by item tag
}

// The three Pokopia item tags the recommendation surface shows. Used by the
// tag-aware retention/ordering query below; the original SQL tag filter in
// `recommendedItemsForHouse` remains untouched (only documented here).
export const RECOMMENDED_ITEM_TAGS = ['Relaxation', 'Decoration', 'Toy'] as const

// Codepoint comparison, matching SQLite's BINARY collation (NOT localeCompare,
// which is locale-dependent and would subtly change sort order vs the old SQL).
function compareCodepoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

let _itemGraphPromise: Promise<ItemGraph> | null = null

// Hydrates the bundled item-graph JSON into the Map-based ItemGraph the
// helpers below consume. Key insertion order of the baked itemsByFavorite /
// recipeByItem objects mirrors the generator's SQL ORDER BY and is preserved
// verbatim here (Map preserves insertion order) — do not re-sort; ordering is
// load-bearing for recommendedItemsForHouse and aggregation parity (AC.7).
// Self-initializing on first use; the promise is cached so all item-facing
// helpers below are pure in-memory map lookups.
export function loadItemGraph(): Promise<ItemGraph> {
  _itemGraphPromise ??= (async (): Promise<ItemGraph> => {
    const baked = loadItemGraphData()

    const itemDetailsByName = new Map<string, ItemDetails>()
    for (const detail of Object.values(baked.itemDetailsByName)) {
      itemDetailsByName.set(detail.name, detail)
    }

    const itemsByFavorite = new Map<string, ItemDetails[]>()
    for (const [favorite, names] of Object.entries(baked.itemsByFavorite)) {
      const items: ItemDetails[] = []
      for (const name of names) {
        const detail = itemDetailsByName.get(name)
        if (detail) items.push(detail)
      }
      itemsByFavorite.set(favorite, items)
    }

    const favoritesByItem = new Map<string, string[]>()
    for (const [itemName, favorites] of Object.entries(baked.favoritesByItem)) {
      favoritesByItem.set(itemName, favorites)
    }

    const recipeByItem = new Map<string, RecipeIngredient[]>()
    for (const [itemName, recipe] of Object.entries(baked.recipeByItem)) {
      recipeByItem.set(itemName, recipe)
    }

    const itemsByTag = new Map<string, ItemDetails[]>()
    for (const detail of itemDetailsByName.values()) {
      if (!detail.tag) continue
      const list = itemsByTag.get(detail.tag)
      if (list) list.push(detail)
      else itemsByTag.set(detail.tag, [detail])
    }

    return { itemDetailsByName, itemsByFavorite, favoritesByItem, recipeByItem, itemsByTag }
  })()
  return _itemGraphPromise
}

export async function getItemMetadata(itemName: string): Promise<{
  isCraftable: boolean
  category: string | null
  flavorText: string | null
  tag: string | null
}> {
  const detail = (await loadItemGraph()).itemDetailsByName.get(itemName)
  if (!detail) return { isCraftable: false, category: null, flavorText: null, tag: null }
  return {
    category: detail.category,
    flavorText: detail.flavorText,
    tag: detail.tag,
    isCraftable: detail.isCraftable,
  }
}

// @lat: [[items#favoritesForItem]]
export async function favoritesForItem(item: string): Promise<string[]> {
  return (await loadItemGraph()).favoritesByItem.get(item) ?? []
}

// Batch favorite lookup for a set of item names in one graph pass. Unknown
// names map to [] (mirrors favoritesForItem). Input names are deduped first.
export async function favoritesForItems(names: string[]): Promise<Map<string, string[]>> {
  const graph = await loadItemGraph()
  const result = new Map<string, string[]>()
  for (const name of new Set(names)) {
    result.set(name, graph.favoritesByItem.get(name) ?? [])
  }
  return result
}

export interface RecommendedHouseItem extends ItemDetails {
  [key: string]: string | boolean | null
}

export function favoriteCoverageColumnKey(favorite: string): string {
  return `fav_${favorite}`
}

function buildFavoriteCounts(allFavorites: string[]): Map<string, number> {
  const favoriteCounts = new Map<string, number>()
  for (const favorite of allFavorites) {
    favoriteCounts.set(favorite, (favoriteCounts.get(favorite) ?? 0) + 1)
  }
  return favoriteCounts
}

// @lat: [[items#recommendedItemsForHouse]]
export async function recommendedItemsForHouse(
  allFavorites: string[],
): Promise<RecommendedHouseItem[]> {
  const favoriteCounts = buildFavoriteCounts(allFavorites)
  if (favoriteCounts.size === 0) return []
  const graph = await loadItemGraph()

  const scored = new Map<
    string,
    { detail: ItemDetails; score: number; matchedFavorites: Set<string> }
  >()
  for (const [favorite, count] of favoriteCounts) {
    for (const detail of graph.itemsByFavorite.get(favorite) ?? []) {
      // SQL tag filter: tag IN ('Relaxation','Decoration','Toy') — NULL tags excluded.
      if (detail.tag !== 'Relaxation' && detail.tag !== 'Decoration' && detail.tag !== 'Toy') {
        continue
      }
      let entry = scored.get(detail.name)
      if (!entry) {
        entry = { detail, score: 0, matchedFavorites: new Set() }
        scored.set(detail.name, entry)
      }
      entry.score += count
      entry.matchedFavorites.add(favorite)
    }
  }

  const favorites = Array.from(favoriteCounts.keys())
  const results = Array.from(scored.values()).map((entry) => {
    const item: RecommendedHouseItem = {
      name: entry.detail.name,
      category: entry.detail.category,
      flavorText: entry.detail.flavorText,
      picturePath: entry.detail.picturePath,
      tag: entry.detail.tag,
      isCraftable: entry.detail.isCraftable,
    }
    for (const favorite of favorites) {
      item[favoriteCoverageColumnKey(favorite)] = entry.matchedFavorites.has(favorite)
    }
    return { item, score: entry.score, covered: entry.matchedFavorites.size }
  })

  // Matches SQL ORDER BY score DESC, covered_count DESC, i.name ASC (BINARY).
  results.sort(
    (a, b) =>
      b.score - a.score || b.covered - a.covered || compareCodepoints(a.item.name, b.item.name),
  )
  return results.map((result) => result.item)
}

/**
 * Tag-aware recommendation query: retains and re-ranks favorite-relevant items
 * by **remaining** house needs, where "needs" = unfulfilled favorites plus
 * unfulfilled item tags (Toy / Relaxation / Decoration).
 *
 * Contract:
 * - Candidate universe is still scoped to items overlapping ≥1 house favorite
 *   (houseFavorites). It never promotes the whole tagged catalog, so an item
 *   with zero house-favorite overlap never appears (empty-cart behavior is
 *   ordering-identical to `recommendedItemsForHouse` — see invariant below).
 * - An item is hidden only when BOTH its favorite coverage and its item tag are
 *   already satisfied (mirrors `recommendedItemsForHouse`'s dedupe of fully
 *   satisfied items). An item whose favorites are all fulfilled but whose tag is
 *   still unmet stays visible.
 * - Ordering: score DESC (unfulfilled favorite multiplicity + one unit per
 *   matched unfulfilled tag), then covered DESC (distinct matched needs), then
 *   name via BINARY codepoint comparison.
 *
 * Invariant: when `unfulfilledTags` is empty the tag pass contributes nothing,
 * so the result reduces exactly to `recommendedItemsForHouse(unfulfilledFavorites)`
 * (same candidates, scores, covered counts, and sort). When every candidate's
 * tag is unfulfilled (the empty-cart case) each candidate gains a uniform `+1`
 * to score and covered, which preserves `recommendedItemsForHouse`'s ordering
 * for equal favorite inputs.
 *
 * @param houseFavorites    all house favorites (candidate universe), with multiplicity
 * @param unfulfilledFavorites remaining favorite needs, with multiplicity
 * @param unfulfilledTags   remaining tag needs (subset of RECOMMENDED_ITEM_TAGS)
 */
export async function recommendedItemsForHouseAllNeeds(
  houseFavorites: string[],
  unfulfilledFavorites: string[],
  unfulfilledTags: string[],
): Promise<RecommendedHouseItem[]> {
  const graph = await loadItemGraph()
  const tagGate = new Set<string>(RECOMMENDED_ITEM_TAGS)

  const scored = new Map<
    string,
    { detail: ItemDetails; score: number; matchedFavorites: Set<string>; matchedTags: Set<string> }
  >()

  // Candidate pass: only items overlapping ≥1 house favorite are eligible.
  for (const favorite of houseFavorites) {
    for (const detail of graph.itemsByFavorite.get(favorite) ?? []) {
      if (!detail.tag || !tagGate.has(detail.tag)) continue
      if (!scored.has(detail.name)) {
        scored.set(detail.name, {
          detail,
          score: 0,
          matchedFavorites: new Set(),
          matchedTags: new Set(),
        })
      }
    }
  }

  // Favorite-need pass: weight by still-unfulfilled favorite multiplicity.
  for (const favorite of unfulfilledFavorites) {
    for (const detail of graph.itemsByFavorite.get(favorite) ?? []) {
      const entry = scored.get(detail.name)
      if (!entry) continue
      entry.score += 1
      entry.matchedFavorites.add(favorite)
    }
  }

  // Tag-need pass: one need-unit per unfulfilled tag an eligible item matches.
  for (const tag of unfulfilledTags) {
    for (const detail of graph.itemsByTag.get(tag) ?? []) {
      const entry = scored.get(detail.name)
      if (!entry || entry.matchedTags.has(tag)) continue
      entry.score += 1
      entry.matchedTags.add(tag)
    }
  }

  // Retention filter: hide only when favorite coverage AND item type are both
  // already satisfied.
  const results = Array.from(scored.values())
    .filter((entry) => entry.matchedFavorites.size > 0 || entry.matchedTags.size > 0)
    .map((entry) => ({
      item: {
        name: entry.detail.name,
        category: entry.detail.category,
        flavorText: entry.detail.flavorText,
        picturePath: entry.detail.picturePath,
        tag: entry.detail.tag,
        isCraftable: entry.detail.isCraftable,
      } as RecommendedHouseItem,
      score: entry.score,
      covered: entry.matchedFavorites.size + entry.matchedTags.size,
    }))

  results.sort(
    (a, b) =>
      b.score - a.score || b.covered - a.covered || compareCodepoints(a.item.name, b.item.name),
  )
  return results.map((result) => result.item)
}

export async function loadPokemonNames(): Promise<string[]> {
  return loadPokemonCatalog().names
}

export async function loadPokemonData(names?: string[]): Promise<PokemonData> {
  const catalog = loadPokemonCatalog()
  const pokemonData: PokemonData = {}
  if (names && names.length === 0) return pokemonData

  // Lazy hydration: with a names list, hydrate only the selected set.
  const selected = names ?? catalog.names
  for (const name of selected) {
    const detail = catalog.dataByName[name]
    if (!detail) continue
    pokemonData[name] = {
      image: detail.image,
      favorites: detail.favorites,
      habitat: detail.habitat,
    }
  }
  return pokemonData
}

export async function getItemPicturePath(itemName: string): Promise<string | null> {
  return (await loadItemGraph()).itemDetailsByName.get(itemName)?.picturePath ?? null
}

export async function getRecipeForItem(itemName: string): Promise<RecipeIngredient[]> {
  const recipe = (await loadItemGraph()).recipeByItem.get(itemName)
  if (!recipe) return []
  // Copy so the cart store (or any caller) never mutates the shared graph.
  return recipe.map((ingredient) => ({ ...ingredient }))
}

export async function getAggregatedIngredients(
  cartItems: Array<{ name: string; quantity: number }>,
): Promise<AggregatedIngredient[]> {
  if (cartItems.length === 0) return []
  const graph = await loadItemGraph()
  const totals = new Map<string, AggregatedIngredient>()
  for (const item of cartItems) {
    const recipe = graph.recipeByItem.get(item.name)
    if (!recipe) continue
    for (const ingredient of recipe) {
      const existing = totals.get(ingredient.ingredientName)
      if (existing) {
        existing.total += ingredient.count * item.quantity
      } else {
        totals.set(ingredient.ingredientName, {
          name: ingredient.ingredientName,
          picturePath: ingredient.ingredientPicture,
          total: ingredient.count * item.quantity,
        })
      }
    }
  }
  // Matches SQL ORDER BY name (BINARY collation).
  return Array.from(totals.values()).sort((a, b) => compareCodepoints(a.name, b.name))
}

// Name kept for call-site stability; the return shape changed from the old
// nested-Map AdjacencyMap to the flat typed-array AdjacencyData (AC.4).
export function loadAdjacencyMap(): Promise<AdjacencyData> {
  return loadAdjacencyData()
}
