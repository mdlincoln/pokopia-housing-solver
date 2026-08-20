// Build-time data bake: reads public/pokehousing.sqlite (source of truth,
// maintained by the harvest scripts) and emits denormalized, ready-to-use
// payloads so the app ships with zero runtime SQL and zero WASM.
//
// Outputs:
//   src/data/pokemon.json        — { names, dataByName }        (bundled by Vite)
//   src/data/items.json          — the ItemGraph shape          (bundled by Vite)
//   public/data/adjacency.json   — { names, size, data(base64 Int16Array) }
//                                  (fetched once at runtime, kept out of the bundle)
//
// ORDER BY clauses are load-bearing: itemsByFavorite / recipeByItem insertion
// order, and GROUP_CONCAT favorites ordering, must match the pre-refactor SQL
// semantics exactly (guarded by scripts/build_data.test.js).
//
// Run with: npm run build:data   (Node 22+, stdlib only)

import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_DB_PATH, openReadOnlyDb, PROJECT_ROOT } from './harvest_lib.js'

const POKEMON_OUT = path.join(PROJECT_ROOT, 'src', 'data', 'pokemon.json')
const ITEMS_OUT = path.join(PROJECT_ROOT, 'src', 'data', 'items.json')
const ADJACENCY_OUT = path.join(PROJECT_ROOT, 'public', 'data', 'adjacency.json')

export function buildPokemon(db) {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.image_path, p.habitat,
              GROUP_CONCAT(pf.favorite_name, '|') AS favorites_str
       FROM pokemon p
       LEFT JOIN pokemon_favorites pf ON p.id = pf.pokemon_id
       GROUP BY p.id, p.name, p.image_path, p.habitat
       ORDER BY p.name ASC`,
    )
    .all()

  const names = []
  const dataByName = {}
  for (const row of rows) {
    names.push(row.name)
    dataByName[row.name] = {
      image: row.image_path || '',
      favorites: row.favorites_str ? String(row.favorites_str).split('|') : [],
      habitat: row.habitat || undefined,
    }
  }
  return { names, dataByName }
}

export function buildItems(db) {
  // Mirrors loadItemGraph()'s three flat SELECTs exactly.
  const itemDetailsByName = {}
  const itemRows = db
    .prepare(
      `SELECT i.name, i.category, i.flavor_text, i.picture_path, i.tag,
              CASE WHEN EXISTS(SELECT 1 FROM item_recipe r WHERE r.item_id = i.id) THEN 1 ELSE 0 END AS craftable
       FROM items i
       ORDER BY i.id`,
    )
    .all()
  for (const row of itemRows) {
    itemDetailsByName[row.name] = {
      name: row.name,
      category: row.category ?? null,
      flavorText: row.flavor_text ?? null,
      picturePath: row.picture_path ?? null,
      tag: row.tag ?? null,
      isCraftable: row.craftable === 1,
    }
  }

  // itemsByFavorite: favorite -> item-name array, in SQL row order (i.id, favorite_name).
  // favoritesByItem: item name -> favorite-name array, same ordering.
  const itemsByFavorite = {}
  const favoritesByItem = {}
  const favoriteRows = db
    .prepare(
      `SELECT i.name AS item_name, IF.favorite_name
       FROM item_favorites IF
       JOIN items i ON i.id = IF.item_id
       ORDER BY i.id, IF.favorite_name`,
    )
    .all()
  for (const row of favoriteRows) {
    if (!(row.item_name in itemDetailsByName)) continue
    ;(itemsByFavorite[row.favorite_name] ??= []).push(row.item_name)
    ;(favoritesByItem[row.item_name] ??= []).push(row.favorite_name)
  }

  // recipeByItem: item name -> ingredient list, in SQL row order (i.id, ing.name).
  const recipeByItem = {}
  const recipeRows = db
    .prepare(
      `SELECT i.name AS item_name, ing.name AS ingredient_name, ing.picture_path, r.count
       FROM item_recipe r
       JOIN items i ON i.id = r.item_id
       JOIN items ing ON ing.id = r.ingredient_id
       ORDER BY i.id, ing.name`,
    )
    .all()
  for (const row of recipeRows) {
    ;(recipeByItem[row.item_name] ??= []).push({
      ingredientName: row.ingredient_name,
      ingredientPicture: row.picture_path ?? null,
      count: row.count,
    })
  }

  return { itemDetailsByName, itemsByFavorite, favoritesByItem, recipeByItem }
}

export function buildAdjacency(db) {
  // ids are dense 1..N — index directly.
  const idRows = db.prepare(`SELECT id, name FROM pokemon ORDER BY id`).all()
  const size = idRows.length
  const names = idRows.map((r) => r.name)

  // Verify the dense-id invariant this encoding depends on.
  for (let i = 0; i < idRows.length; i++) {
    if (idRows[i].id !== i + 1) {
      throw new Error(
        `pokemon ids are not dense 1..N: id=${idRows[i].id} at index ${i}. ` +
          'The dense Int16Array encoding requires gapless ids.',
      )
    }
  }

  const matrix = new Int16Array(size * size) // 0 = no edge (also the diagonal)
  const edgeRows = db.prepare(`SELECT pokemon_a, pokemon_b, score FROM adjacency`).all()
  for (const row of edgeRows) {
    const v = row.score === null ? -1 : row.score
    matrix[(row.pokemon_a - 1) * size + (row.pokemon_b - 1)] = v
  }

  const data = Buffer.from(matrix.buffer).toString('base64')
  return { names, size, data, edgeCount: edgeRows.length }
}

function main() {
  const db = openReadOnlyDb(DEFAULT_DB_PATH)
  try {
    const pokemon = buildPokemon(db)
    const items = buildItems(db)
    const adjacency = buildAdjacency(db)

    fs.mkdirSync(path.dirname(POKEMON_OUT), { recursive: true })
    fs.mkdirSync(path.dirname(ITEMS_OUT), { recursive: true })
    fs.mkdirSync(path.dirname(ADJACENCY_OUT), { recursive: true })

    fs.writeFileSync(POKEMON_OUT, JSON.stringify(pokemon) + '\n')
    fs.writeFileSync(ITEMS_OUT, JSON.stringify(items) + '\n')
    fs.writeFileSync(
      ADJACENCY_OUT,
      JSON.stringify({ names: adjacency.names, size: adjacency.size, data: adjacency.data }) + '\n',
    )

    console.log(`pokemon.json: ${pokemon.names.length} pokemon`)
    console.log(
      `items.json: ${Object.keys(items.itemDetailsByName).length} items, ` +
        `${Object.keys(items.itemsByFavorite).length} favorites, ` +
        `${Object.keys(items.recipeByItem).length} recipes`,
    )
    console.log(
      `adjacency.json: ${adjacency.size}x${adjacency.size} matrix, ` +
        `${adjacency.edgeCount} edges, ${(fs.statSync(ADJACENCY_OUT).size / 1024).toFixed(0)} KiB on disk`,
    )
  } finally {
    db.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? '')) {
  main()
}
