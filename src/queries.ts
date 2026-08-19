import { getDb } from '@/db'
import type { AdjacencyMap, PokemonData } from '@/solver'

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

interface ItemGraph {
  itemDetailsByName: Map<string, ItemDetails>
  itemsByFavorite: Map<string, ItemDetails[]> // shared ItemDetails refs
  favoritesByItem: Map<string, string[]>
  recipeByItem: Map<string, RecipeIngredient[]>
}

// Codepoint comparison, matching SQLite's BINARY collation (NOT localeCompare,
// which is locale-dependent and would subtly change sort order vs the old SQL).
function compareCodepoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

let _itemGraphPromise: Promise<ItemGraph> | null = null

// Loads the entire item domain in 3 flat SELECTs and builds shared-object maps.
// Self-initializing on first use; the promise is cached so all item-facing
// helpers below are pure in-memory map lookups with no further SQL.
export function loadItemGraph(): Promise<ItemGraph> {
  _itemGraphPromise ??= (async (): Promise<ItemGraph> => {
    const db = await getDb()

    const itemDetailsByName: Map<string, ItemDetails> = new Map()
    const itemRows = db.exec(
      `SELECT i.name, i.category, i.flavor_text, i.picture_path, i.tag,
              CASE WHEN EXISTS(SELECT 1 FROM item_recipe r WHERE r.item_id = i.id) THEN 1 ELSE 0 END
       FROM items i
       ORDER BY i.id`,
    )[0]
    if (itemRows) {
      for (const row of itemRows.values) {
        const detail: ItemDetails = {
          name: row[0] as string,
          category: (row[1] as string | null) ?? null,
          flavorText: (row[2] as string | null) ?? null,
          picturePath: (row[3] as string | null) ?? null,
          tag: (row[4] as string | null) ?? null,
          isCraftable: (row[5] as number) === 1,
        }
        itemDetailsByName.set(detail.name, detail)
      }
    }

    const itemsByFavorite: Map<string, ItemDetails[]> = new Map()
    const favoritesByItem: Map<string, string[]> = new Map()
    const favoriteRows = db.exec(
      `SELECT i.name, IF.favorite_name
       FROM item_favorites IF
       JOIN items i ON i.id = IF.item_id
       ORDER BY i.id, IF.favorite_name`,
    )[0]
    if (favoriteRows) {
      for (const row of favoriteRows.values) {
        const itemName = row[0] as string
        const favorite = row[1] as string
        const detail = itemDetailsByName.get(itemName)
        if (!detail) continue
        let items = itemsByFavorite.get(favorite)
        if (!items) {
          items = []
          itemsByFavorite.set(favorite, items)
        }
        items.push(detail)
        let favorites = favoritesByItem.get(itemName)
        if (!favorites) {
          favorites = []
          favoritesByItem.set(itemName, favorites)
        }
        favorites.push(favorite)
      }
    }

    const recipeByItem: Map<string, RecipeIngredient[]> = new Map()
    const recipeRows = db.exec(
      `SELECT i.name, ing.name, ing.picture_path, r.count
       FROM item_recipe r
       JOIN items i ON i.id = r.item_id
       JOIN items ing ON ing.id = r.ingredient_id
       ORDER BY i.id, ing.name`,
    )[0]
    if (recipeRows) {
      for (const row of recipeRows.values) {
        const itemName = row[0] as string
        let recipe = recipeByItem.get(itemName)
        if (!recipe) {
          recipe = []
          recipeByItem.set(itemName, recipe)
        }
        recipe.push({
          ingredientName: row[1] as string,
          ingredientPicture: (row[2] as string | null) ?? null,
          count: row[3] as number,
        })
      }
    }

    return { itemDetailsByName, itemsByFavorite, favoritesByItem, recipeByItem }
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

export async function loadPokemonNames(): Promise<string[]> {
  const db = await getDb()
  const rows = db.exec(
    `SELECT p.name
     FROM pokemon p
     ORDER BY p.name ASC`,
  )[0]
  if (!rows) return []
  return rows.values.map((row) => row[0] as string)
}

export async function loadPokemonData(names?: string[]): Promise<PokemonData> {
  const db = await getDb()
  const pokemonData: PokemonData = {}
  if (names && names.length === 0) return pokemonData

  const whereClause = names ? `WHERE p.name IN (${names.map(() => '?').join(', ')})` : ''
  const rows = db.exec(
    `SELECT p.name, p.image_path, p.habitat,
            GROUP_CONCAT(pf.favorite_name, '|') as favorites_str
     FROM pokemon p
     LEFT JOIN pokemon_favorites pf ON p.id = pf.pokemon_id
     ${whereClause}
     GROUP BY p.id, p.name, p.image_path, p.habitat
     ORDER BY p.name ASC`,
    names ?? [],
  )[0]
  if (rows) {
    for (const row of rows.values) {
      const [name, imagePath, habitat, favoritesStr] = row as [string, string, string, string]
      pokemonData[name] = {
        image: imagePath || '',
        favorites: favoritesStr ? favoritesStr.split('|') : [],
        habitat: habitat || undefined,
      }
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

export async function loadAdjacencyMap(): Promise<AdjacencyMap> {
  const db = await getDb()
  const adjacencyMap: AdjacencyMap = new Map()
  const rows = db.exec(
    `SELECT p1.name as pokemon_a, p2.name as pokemon_b, a.score
     FROM adjacency a
     JOIN pokemon p1 ON a.pokemon_a = p1.id
     JOIN pokemon p2 ON a.pokemon_b = p2.id`,
  )[0]
  if (rows) {
    for (const row of rows.values) {
      const [pokemonA, pokemonB, score] = row as [string, string, number | null]
      if (!adjacencyMap.has(pokemonA)) adjacencyMap.set(pokemonA, new Map())
      if (!adjacencyMap.has(pokemonB)) adjacencyMap.set(pokemonB, new Map())
      adjacencyMap.get(pokemonA)!.set(pokemonB, score)
      adjacencyMap.get(pokemonB)!.set(pokemonA, score)
    }
  }
  return adjacencyMap
}
