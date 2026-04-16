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

// @lat: [[items#itemsForFavorite]]
export async function itemsForFavorite(favorite: string): Promise<ItemDetails[]> {
  const db = await getDb()
  const normalized = favorite.toLowerCase()
  const rows = db.exec(
    `SELECT i.name, i.category, i.flavor_text, i.picture_path, i.tag,
            CASE WHEN COUNT(r.ingredient_id) > 0 THEN 1 ELSE 0 END AS is_craftable
     FROM items i
     JOIN item_favorites IF ON i.id = IF.item_id
     LEFT JOIN item_recipe r ON r.item_id = i.id
     WHERE IF.favorite_name = ?
     GROUP BY i.id, i.name, i.category, i.flavor_text, i.picture_path, i.tag`,
    [normalized],
  )[0]
  if (!rows) return []
  return rows.values.map((row) => ({
    name: row[0] as string,
    category: (row[1] as string | null) ?? null,
    flavorText: (row[2] as string | null) ?? null,
    picturePath: (row[3] as string | null) ?? null,
    tag: (row[4] as string | null) ?? null,
    isCraftable: (row[5] as number) === 1,
  }))
}

export async function getItemMetadata(itemName: string): Promise<{
  isCraftable: boolean
  category: string | null
  flavorText: string | null
  tag: string | null
}> {
  const db = await getDb()
  const rows = db.exec(
    `SELECT i.category, i.flavor_text, i.tag,
            CASE WHEN COUNT(r.ingredient_id) > 0 THEN 1 ELSE 0 END AS is_craftable
     FROM items i
     LEFT JOIN item_recipe r ON r.item_id = i.id
     WHERE LOWER(i.name) = ?
     GROUP BY i.id`,
    [itemName.toLowerCase()],
  )[0]
  if (!rows || rows.values.length === 0)
    return { isCraftable: false, category: null, flavorText: null, tag: null }
  const row = rows.values[0]!
  return {
    category: (row[0] as string | null) ?? null,
    flavorText: (row[1] as string | null) ?? null,
    tag: (row[2] as string | null) ?? null,
    isCraftable: (row[3] as number) === 1,
  }
}

// @lat: [[items#favoritesForItem]]
const _itemFavsCache = new Map<string, string[]>()
export async function favoritesForItem(item: string): Promise<string[]> {
  const normalized = item.toLowerCase()
  const cached = _itemFavsCache.get(normalized)
  if (cached) return cached
  const db = await getDb()
  const rows = db.exec(
    `SELECT IF.favorite_name FROM item_favorites IF
       JOIN items i ON i.id = IF.item_id
       WHERE LOWER(i.name) = ?
       ORDER BY IF.favorite_name ASC`,
    [normalized],
  )[0]
  const result = rows ? rows.values.map((row) => row[0] as string) : []
  _itemFavsCache.set(normalized, result)
  return result
}

export interface ItemScore {
  item: string
  score: number
}

export interface RecommendedHouseItem extends ItemDetails {
  [key: string]: string | boolean | null
}

export function favoriteCoverageColumnKey(favorite: string): string {
  return `fav_${favorite.toLowerCase()}`
}

function buildFavoriteCounts(allFavorites: string[]): Map<string, number> {
  const favoriteCounts = new Map<string, number>()
  for (const favorite of allFavorites) {
    const normalized = favorite.toLowerCase()
    favoriteCounts.set(normalized, (favoriteCounts.get(normalized) ?? 0) + 1)
  }
  return favoriteCounts
}

function favoriteCoverageColumnAlias(favorite: string): string {
  return `"${favoriteCoverageColumnKey(favorite).replace(/"/g, '""')}"`
}

function mapRecommendedHouseItemRow(row: unknown[], favorites: string[]): RecommendedHouseItem {
  const item: RecommendedHouseItem = {
    name: row[0] as string,
    category: (row[1] as string | null) ?? null,
    flavorText: (row[2] as string | null) ?? null,
    picturePath: (row[3] as string | null) ?? null,
    tag: (row[4] as string | null) ?? null,
    isCraftable: (row[5] as number) === 1,
  }

  for (const [index, favorite] of favorites.entries()) {
    item[favoriteCoverageColumnKey(favorite)] = (row[6 + index] as number) === 1
  }

  return item
}

// @lat: [[items#recommendedItemsForHouse]]
export async function recommendedItemsForHouse(
  allFavorites: string[],
): Promise<RecommendedHouseItem[]> {
  const db = await getDb()
  const favoriteCounts = buildFavoriteCounts(allFavorites)
  if (favoriteCounts.size === 0) return []

  const favorites = Array.from(favoriteCounts.keys())
  const favoriteValuesSql = favorites.map(() => '(?, ?)').join(', ')
  const favoriteSelectSql = favorites
    .map(
      (favorite) =>
        `MAX(CASE WHEN IF.favorite_name = ? THEN 1 ELSE 0 END) AS ${favoriteCoverageColumnAlias(favorite)}`,
    )
    .join(',\n            ')
  const params: Array<string | number> = []
  for (const [favorite, count] of favoriteCounts) {
    params.push(favorite, count)
  }
  params.push(...favorites)

  const rows = db.exec(
    `WITH house_favorites(favorite_name, favorite_count) AS (VALUES ${favoriteValuesSql})
     SELECT i.name,
            i.category,
            i.flavor_text,
            i.picture_path,
            i.tag,
            CASE WHEN EXISTS(SELECT 1 FROM item_recipe r WHERE r.item_id = i.id) THEN 1 ELSE 0 END AS is_craftable,
            ${favoriteSelectSql},
            SUM(hf.favorite_count) AS score,
            COUNT(DISTINCT IF.favorite_name) AS covered_count
     FROM items i
     JOIN item_favorites IF ON i.id = IF.item_id
     JOIN house_favorites hf ON hf.favorite_name = IF.favorite_name
     WHERE LOWER(i.tag) IN ('relaxation', 'decoration', 'toy')
     GROUP BY i.id, i.name, i.category, i.flavor_text, i.picture_path, i.tag
     ORDER BY score DESC, covered_count DESC, LOWER(i.name) ASC, i.name ASC`,
    params,
  )[0]

  if (!rows) return []

  return rows.values.map((row) => mapRecommendedHouseItemRow(row, favorites))
}

// @lat: [[items#idealItems]]
export async function idealItems(favorites: string[]): Promise<ItemScore[]> {
  const db = await getDb()
  const normalized = favorites.map((f) => f.toLowerCase())
  const counts = new Map<string, number>()

  for (const fav of normalized) {
    const rows = db.exec(
      `SELECT i.name FROM items i
         JOIN item_favorites IF ON i.id = IF.item_id
         WHERE IF.favorite_name = ?`,
      [fav],
    )[0]
    if (!rows) continue
    for (const row of rows.values) {
      const itemName = row[0] as string
      counts.set(itemName, (counts.get(itemName) ?? 0) + 1)
    }
  }

  return Array.from(counts, ([item, score]) => ({ item, score }))
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

export async function getItemPicturePath(itemName: string): Promise<string | null> {
  const db = await getDb()
  const rows = db.exec(`SELECT picture_path FROM items WHERE LOWER(name) = ?`, [
    itemName.toLowerCase(),
  ])[0]
  if (!rows || rows.values.length === 0) return null
  return (rows.values[0]![0] as string | null) ?? null
}

export async function getRecipeForItem(itemName: string): Promise<RecipeIngredient[]> {
  const db = await getDb()
  const rows = db.exec(
    `SELECT ing.name, ing.picture_path, r.count
     FROM items i
     JOIN item_recipe r ON r.item_id = i.id
     JOIN items ing ON r.ingredient_id = ing.id
     WHERE LOWER(i.name) = ?
     ORDER BY ing.name`,
    [itemName.toLowerCase()],
  )[0]
  if (!rows) return []
  return rows.values.map((row) => ({
    ingredientName: row[0] as string,
    ingredientPicture: (row[1] as string | null) ?? null,
    count: row[2] as number,
  }))
}

export async function getAggregatedIngredients(
  cartItems: Array<{ name: string; quantity: number }>,
): Promise<AggregatedIngredient[]> {
  if (cartItems.length === 0) return []
  const db = await getDb()
  const unions = cartItems
    .map(
      () =>
        `SELECT ing.name, ing.picture_path, r.count * ? AS scaled
       FROM items i
       JOIN item_recipe r ON r.item_id = i.id
       JOIN items ing ON r.ingredient_id = ing.id
       WHERE LOWER(i.name) = ?`,
    )
    .join(' UNION ALL ')
  const sql = `SELECT name, picture_path, SUM(scaled) as total FROM (${unions}) GROUP BY name, picture_path ORDER BY name`
  const params: (string | number)[] = []
  for (const item of cartItems) {
    params.push(item.quantity, item.name.toLowerCase())
  }
  const rows = db.exec(sql, params)[0]
  if (!rows) return []
  return rows.values.map((row) => ({
    name: row[0] as string,
    picturePath: (row[1] as string | null) ?? null,
    total: row[2] as number,
  }))
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
