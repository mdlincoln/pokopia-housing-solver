import { getDb } from '@/db'
import type { AdjacencyMap, PokemonData } from '@/solver'

// @lat: [[items#itemsForFavorite]]
export async function itemsForFavorite(favorite: string): Promise<string[]> {
  const db = await getDb()
  const normalized = favorite.toLowerCase()
  const rows = db.exec(
    `SELECT i.name FROM items i
       JOIN item_favorites IF ON i.id = IF.item_id
       WHERE IF.favorite_name = ?`,
    [normalized],
  )[0]
  if (!rows) return []
  return rows.values.map((row) => row[0] as string)
}

// @lat: [[items#favoritesForItem]]
export async function favoritesForItem(item: string): Promise<string[]> {
  const db = await getDb()
  const normalized = item.toLowerCase()
  const rows = db.exec(
    `SELECT IF.favorite_name FROM item_favorites IF
       JOIN items i ON i.id = IF.item_id
       WHERE LOWER(i.name) = ?
       ORDER BY IF.favorite_name ASC`,
    [normalized],
  )[0]
  if (!rows) return []
  return rows.values.map((row) => row[0] as string)
}

export interface ItemScore {
  item: string
  score: number
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

export async function loadPokemonData(): Promise<PokemonData> {
  const db = await getDb()
  const pokemonData: PokemonData = {}
  const rows = db.exec(
    `SELECT p.name, p.image_path, p.habitat,
            GROUP_CONCAT(pf.favorite_name, '|') as favorites_str
     FROM pokemon p
     LEFT JOIN pokemon_favorites pf ON p.id = pf.pokemon_id
     GROUP BY p.id, p.name, p.image_path, p.habitat
     ORDER BY p.name ASC`,
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
