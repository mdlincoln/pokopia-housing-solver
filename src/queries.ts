// Query layer over the build-time baked data (see scripts/build_data.mjs and
// src/data/index.ts). No SQL or WASM runs in the browser: the pokemon catalog
// and item graph are bundled JSON, and the adjacency matrix is a single fetch
// decoded into a flat Int16Array. This module is the only one that reads the
// baked data — never import src/data/* from components or other modules.

import {
  loadAdjacencyData,
  loadHabitatCatalogData,
  loadItemGraphData,
  loadPokemonCatalog,
} from '@/data'
import { getScore, type AdjacencyData, type PokemonData } from '@/solver'

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

export interface HouseMateMatch {
  name: string
  image: string
  favorites: string[]
  habitat?: string
  overlapScore: number // Σ getScore vs occupants (0 when no occupants / no adjacency)
  fulfilledCount: number // candidate favorites fulfilled by the house's cart items
  score: number // overlapScore + fulfilledCount
  sharedFavorites: string[] // candidate favorites shared with ≥1 occupant (display)
  fulfilledFavorites: string[] // candidate favorites fulfilled by cart items (display)
}

/**
 * Ranks the best-fitting pokemon to JOIN a given house — the data behind the
 * "+" empty-slot suggestion modal on HouseRecord.
 *
 * Signals:
 * - Occupant chemistry: Σ getScore(candidate, occupant) from the adjacency
 *   matrix. A hard exclusion (getScore === null, opposite habitat axis) vs ANY
 *   occupant drops the candidate entirely.
 * - Stocked-wishlist bonus: +1 per candidate favorite already fulfilled by the
 *   house's cart items (one `favoritesForItems` union pass).
 *
 * Tier behavior (fixed regardless of weighting):
 * - Occupants > 0, no items: rank by overlapScore; ALL non-conflicting
 *   candidates are eligible (score-0 candidates are neutral, not conflicting).
 * - Items > 0, no occupants: candidates require fulfilledCount ≥ 1; if none
 *   qualify the result is [] (the modal falls back to its search input).
 * - Both present: all non-conflicting candidates eligible; fulfillment is a
 *   bonus, not a gate.
 * - Neither: callers don't invoke (totally empty houses render the inline
 *   search input instead).
 *
 * Deterministic ordering: score DESC, then island affinity DESC (Σ getScore
 * over `excludedNames`, with hard exclusions counted as 0 — cross-house
 * conflicts never EXCLUDE a candidate from this house; occupants-only), then
 * name via BINARY codepoint comparison (matching this module's parity
 * convention, NOT localeCompare).
 *
 * @param candidateNames test-only override for the candidate universe
 *   (production callers omit it and rank the full catalog).
 */
export async function topHouseMates(opts: {
  occupants: string[]
  cartItemNames: string[]
  excludedNames: ReadonlySet<string>
  adjacency: AdjacencyData
  limit?: number
  candidateNames?: string[]
}): Promise<HouseMateMatch[]> {
  const limit = opts.limit ?? 5
  const universe = opts.candidateNames ?? loadPokemonCatalog().names
  const candidates = universe.filter((name) => !opts.excludedNames.has(name))
  if (candidates.length === 0) return []

  // Favorites/images/habitat for candidates AND occupants come from one
  // hydration pass (names absent from the catalog map to empty entries).
  const hydrated = await loadPokemonData([...new Set([...candidates, ...opts.occupants])])

  // Union of favorites fulfilled by the house's cart items (empty when the
  // house has no items — the fulfilled signal then contributes nothing).
  const fulfilledSet = new Set<string>()
  if (opts.cartItemNames.length > 0) {
    const cartFavs = await favoritesForItems(opts.cartItemNames)
    for (const favorites of cartFavs.values()) {
      for (const favorite of favorites) fulfilledSet.add(favorite)
    }
  }

  const occupantFavorites = new Set(opts.occupants.flatMap((o) => hydrated[o]?.favorites ?? []))
  const hasOccupants = opts.occupants.length > 0

  const scored: Array<{ match: HouseMateMatch; islandAffinity: number }> = []
  for (const name of candidates) {
    // Hard environment filter: an opposite-axis conflict with ANY occupant
    // excludes the candidate from this house.
    let overlapScore = 0
    let conflicts = false
    for (const occupant of opts.occupants) {
      const score = getScore(opts.adjacency, name, occupant)
      if (score === null) {
        conflicts = true
        break
      }
      overlapScore += score
    }
    if (conflicts) continue

    const entry = hydrated[name]
    const favorites = entry?.favorites ?? []
    const fulfilledFavorites = favorites.filter((f) => fulfilledSet.has(f))
    const fulfilledCount = fulfilledFavorites.length

    // Items-only tier: without occupants there is no chemistry signal, so
    // only candidates whose wishlist is partially stocked qualify.
    if (!hasOccupants && opts.cartItemNames.length > 0 && fulfilledCount === 0) continue

    // Island-wide affinity is a pure ranking tie-break: null (cross-house
    // conflict) contributes 0 but never excludes.
    let islandAffinity = 0
    for (const islandName of opts.excludedNames) {
      islandAffinity += getScore(opts.adjacency, name, islandName) ?? 0
    }

    scored.push({
      match: {
        name,
        image: entry?.image ?? '',
        favorites,
        habitat: entry?.habitat,
        overlapScore,
        fulfilledCount,
        score: overlapScore + fulfilledCount,
        sharedFavorites: favorites.filter((f) => occupantFavorites.has(f)),
        fulfilledFavorites,
      },
      islandAffinity,
    })
  }

  scored.sort(
    (a, b) =>
      b.match.score - a.match.score ||
      b.islandAffinity - a.islandAffinity ||
      compareCodepoints(a.match.name, b.match.name),
  )
  return scored.slice(0, limit).map((entry) => entry.match)
}

export async function loadPokemonData(names?: string[]): Promise<PokemonData> {
  const catalog = loadPokemonCatalog()
  const pokemonData: PokemonData = {}
  if (names && names.length === 0) return pokemonData

  // Lazy hydration: with a names list, hydrate only the selected set. The
  // returned entries are built fresh with exactly the solver-facing keys —
  // the catalog's `spawnHabitats` array is deliberately NOT copied through,
  // keeping the PokemonData worker payload shape byte-identical (guarded by
  // src/__tests__/queries.spec.ts).
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

// ---------------------------------------------------------------------------
// Spawn habitats (the habitat_entries / habitat_pokemon* DB surface).
// ---------------------------------------------------------------------------

export interface SpawnHabitat {
  id: number
  name: string
  image: string
}

export interface HabitatSpawn {
  name: string
  rarity: string | null
  times: string[]
  weathers: string[]
  locations: string[]
}

export interface HabitatDetails {
  id: number
  name: string
  image: string
  description: string
  category: string
  pokemon: HabitatSpawn[]
}

// Hydrates the spawn-habitat arrays for the given pokemon (all catalog pokemon
// when omitted). Entries are fresh objects so Vue reactivity proxies wrapping
// the result never reach the cached catalog. Pokemon with no spawn data are
// omitted from the result.
export async function loadSpawnHabitatsByName(
  names?: string[],
): Promise<Record<string, SpawnHabitat[]>> {
  const catalog = loadPokemonCatalog()
  const result: Record<string, SpawnHabitat[]> = {}
  const selected = names ?? catalog.names
  for (const name of selected) {
    const detail = catalog.dataByName[name]
    if (!detail?.spawnHabitats) continue
    result[name] = detail.spawnHabitats.map((habitat) => ({ ...habitat }))
  }
  return result
}

let _habitatGraphPromise: Promise<Map<number, HabitatDetails>> | null = null

// Hydrates the bundled habitats.json into a Map keyed by habitat id. Insertion
// order follows the baked key order (habitat id ASC). Cached promise mirrors
// loadItemGraph: every habitat-facing helper below is a pure map lookup, and
// detail/sprite results are shallow copies so callers (components) never
// mutate or reactively wrap the shared graph data.
export function loadHabitatGraph(): Promise<Map<number, HabitatDetails>> {
  _habitatGraphPromise ??= (async (): Promise<Map<number, HabitatDetails>> => {
    const baked = loadHabitatCatalogData()
    const graph = new Map<number, HabitatDetails>()
    for (const [key, habitat] of Object.entries(baked)) {
      graph.set(Number(key), {
        ...habitat,
        pokemon: habitat.pokemon.map((spawn) => ({ ...spawn })),
      })
    }
    return graph
  })()
  return _habitatGraphPromise
}

export async function getHabitatDetails(id: number): Promise<HabitatDetails | null> {
  return (await loadHabitatGraph()).get(id) ?? null
}

// Batch catalog sprite lookup for a habitat roster. Roster names absent from
// the pokemon catalog (e.g. Porygon-Z) map to null so the modal can render a
// name-only row.
export async function getPokemonSprites(names: string[]): Promise<Record<string, string | null>> {
  const catalog = loadPokemonCatalog()
  const result: Record<string, string | null> = {}
  for (const name of names) {
    result[name] = catalog.dataByName[name]?.image ?? null
  }
  return result
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
