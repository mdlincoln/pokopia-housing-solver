// Build-time data bake: reads src/pokehousing.sqlite (source of truth,
// maintained by the harvest scripts) and emits denormalized, ready-to-use
// payloads so the app ships with zero runtime SQL and zero WASM.
//
// Outputs:
//   src/data/pokemon.json        — { names, dataByName }        (bundled by Vite)
//   src/data/items.json          — the ItemGraph shape          (bundled by Vite)
//   src/data/habitats.json       — the HabitatCatalog shape     (bundled by Vite)
//   public/data/adjacency.json   — { names, size, data(base64 Int16Array) }  (fetched)
//   public/data/tombstones.json  — { pokemon/items/habitats: {oldName: canonicalName} }
//                                  (fetched once at runtime, kept out of the bundle; baked
//                                  from the *_tombstones tables maintained by the rename CLI)
//
// ORDER BY clauses are load-bearing: itemsByFavorite / recipeByItem insertion
// order, and GROUP_CONCAT favorites ordering, must match the pre-refactor SQL
// semantics exactly (guarded by scripts/build_data.test.js).
//
// Run with: npm run build:data   (Node 22+, stdlib only)

import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_DB_PATH, openReadOnlyDb, PROJECT_ROOT } from './harvest_lib.js'
import { formatDataJson } from './format_data.mjs'

export function outputPaths(projectRoot = PROJECT_ROOT) {
  return {
    pokemonOut: path.join(projectRoot, 'src', 'data', 'pokemon.json'),
    itemsOut: path.join(projectRoot, 'src', 'data', 'items.json'),
    habitatsOut: path.join(projectRoot, 'src', 'data', 'habitats.json'),
    adjacencyOut: path.join(projectRoot, 'public', 'data', 'adjacency.json'),
    tombstonesOut: path.join(projectRoot, 'public', 'data', 'tombstones.json'),
  }
}

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

  // Spawn habitats per pokemon (one thumbnail per habitat the pokemon spawns
  // in, ordered by habitat number). Pokemon with no spawn rows get the key
  // omitted so loadPokemonData's solver-shaped output needs no stripping.
  // he.id is a deterministic final tiebreak: habitat `number` is only unique
  // within a section (Main/Basin/Event), not globally.
  const spawnRows = db
    .prepare(
      `SELECT p.name AS pokemon_name, he.id AS habitat_id, he.number AS habitat_number,
              he.name AS habitat_name, he.image_path
       FROM pokemon p
       JOIN habitat_pokemon hp ON hp.pokemon_name = p.name
       JOIN habitat_entries he ON he.id = hp.habitat_id
       ORDER BY p.name ASC, he.number ASC, he.id ASC`,
    )
    .all()
  const spawnHabitatsByName = {}
  for (const row of spawnRows) {
    ;(spawnHabitatsByName[row.pokemon_name] ??= []).push({
      id: row.habitat_id,
      name: row.habitat_name,
      image: row.image_path,
    })
  }

  const names = []
  const dataByName = {}
  for (const row of rows) {
    names.push(row.name)
    dataByName[row.name] = {
      image: row.image_path || '',
      favorites: row.favorites_str ? String(row.favorites_str).split('|') : [],
      habitat: row.habitat || undefined,
      ...(spawnHabitatsByName[row.name] ? { spawnHabitats: spawnHabitatsByName[row.name] } : {}),
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

// Normalizes scraped habitat-pokemon rarity values into the pinned set
// {null, 'Common', 'Rare', 'Very Rare'}. The harvest-side bug that produced
// the duplicated 'CommonCommon' string is a documented follow-up; normalizing
// here makes the bake self-healing for future dirty harvests.
const VALID_RARITIES = new Set(['Common', 'Rare', 'Very Rare'])

export function normalizeRarity(rarity) {
  if (rarity === null || rarity === undefined) return null
  const value = String(rarity)
  if (VALID_RARITIES.has(value)) return value
  // Doubled-word scrape artifacts ('CommonCommon' → 'Common').
  if (value.length % 2 === 0) {
    const half = value.slice(0, value.length / 2)
    if (half + half === value && VALID_RARITIES.has(half)) return half
  }
  return null
}

// The habitat spawn catalog keyed by habitat id: every habitat's metadata plus
// its full pokemon roster (rarity, spawn times, weathers, locations). Insert
// order follows habitat_entries.id ASC (roster rows follow habitat_id ASC,
// pokemon_name ASC; roster join values ASC).
export function buildHabitats(db) {
  const habitats = {}
  for (const row of db
    .prepare(
      `SELECT id, name, image_path, description, category
       FROM habitat_entries
       ORDER BY id ASC`,
    )
    .all()) {
    habitats[row.id] = {
      id: row.id,
      name: row.name,
      image: row.image_path,
      description: row.description ?? '',
      category: row.category ?? '',
      pokemon: [],
    }
  }

  for (const row of db
    .prepare(
      `SELECT habitat_id, pokemon_name, rarity
       FROM habitat_pokemon
       ORDER BY habitat_id ASC, pokemon_name ASC`,
    )
    .all()) {
    const habitat = habitats[row.habitat_id]
    if (!habitat) continue
    habitat.pokemon.push({
      name: row.pokemon_name,
      rarity: normalizeRarity(row.rarity),
      times: [],
      weathers: [],
      locations: [],
    })
  }

  // Spawn join values, one row per value. (habitat_id, pokemon_name) is unique
  // in habitat_pokemon, so each spawn appears at most once per roster scan.
  const joinLists = [
    ['habitat_pokemon_time', 'time', 'times'],
    ['habitat_pokemon_weather', 'weather', 'weathers'],
    ['habitat_pokemon_location', 'location', 'locations'],
  ]
  for (const [table, column, target] of joinLists) {
    for (const row of db
      .prepare(
        `SELECT habitat_id, pokemon_name, ${column} AS value
         FROM ${table}
         ORDER BY habitat_id ASC, pokemon_name ASC, value ASC`,
      )
      .all()) {
      const habitat = habitats[row.habitat_id]
      if (!habitat) continue
      const spawn = habitat.pokemon.find((p) => p.name === row.pokemon_name)
      if (spawn) spawn[target].push(row.value)
    }
  }

  return habitats
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

// Tombstone (old name -> canonical name) maps, baked from the *_tombstones
// tables the rename CLI maintains. Chains are flattened transitively here
// (A->B, B->C bakes as A->C) so the runtime lookup is a single map read;
// cycles and orphans are maintainer errors and fail the bake loudly, matching
// the repo's verify-gate philosophy rather than degrading silently in the
// browser. The payload is always emitted (even with every map empty) so the
// runtime fetch never 404s; a pre-migration DB without the tombstone tables
// tolerantly bakes empty maps.
const TOMBSTONE_PAIRS = [
  { table: 'pokemon_tombstones', entity: 'pokemon', fk: 'pokemon_id', mapKey: 'pokemon' },
  { table: 'item_tombstones', entity: 'items', fk: 'item_id', mapKey: 'items' },
  {
    table: 'habitat_tombstones',
    entity: 'habitat_entries',
    fk: 'habitat_id',
    mapKey: 'habitats',
  },
]

export function buildTombstones(db) {
  const result = {}
  for (const { table, entity, fk, mapKey } of TOMBSTONE_PAIRS) {
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table)
    if (!exists) {
      result[mapKey] = {}
      continue
    }
    // LEFT JOIN so orphaned tombstone rows (target entity missing) are
    // visible; FKs normally prevent this, but rows inserted with FKs off
    // would silently drop out of an INNER JOIN.
    const rows = db
      .prepare(
        `SELECT t.old_name, e.name AS new_name ` +
          `FROM ${table} t LEFT JOIN ${entity} e ON e.id = t.${fk} ` +
          `ORDER BY t.old_name ASC`,
      )
      .all()

    const orphans = rows.filter((r) => r.new_name === null).map((r) => r.old_name)
    if (orphans.length > 0) {
      throw new Error(
        `Tombstone orphan(s) in ${table}: ${orphans.join(', ')} — the target entity no longer ` +
          `exists. Delete the tombstone row(s) or re-point them at a live entity.`,
      )
    }

    const direct = new Map(rows.map((r) => [r.old_name, r.new_name]))
    const resolved = {}
    for (const [oldName, newName] of direct) {
      const chain = [oldName, newName]
      const visited = new Set([oldName])
      let current = newName
      while (direct.has(current)) {
        if (visited.has(current)) {
          throw new Error(`Tombstone cycle in ${table}: ${chain.join(' -> ')} -> ${current}`)
        }
        visited.add(current)
        current = direct.get(current)
        chain.push(current)
      }
      resolved[oldName] = current
    }
    result[mapKey] = resolved
  }
  return result
}

export function bake(dbPath, projectRoot = PROJECT_ROOT) {
  const { pokemonOut, itemsOut, habitatsOut, adjacencyOut, tombstonesOut } =
    outputPaths(projectRoot)
  const db = openReadOnlyDb(dbPath)
  try {
    const pokemon = buildPokemon(db)
    const items = buildItems(db)
    const habitats = buildHabitats(db)
    const adjacency = buildAdjacency(db)
    const tombstones = buildTombstones(db)

    fs.mkdirSync(path.dirname(pokemonOut), { recursive: true })
    fs.mkdirSync(path.dirname(itemsOut), { recursive: true })
    fs.mkdirSync(path.dirname(habitatsOut), { recursive: true })
    fs.mkdirSync(path.dirname(adjacencyOut), { recursive: true })
    fs.mkdirSync(path.dirname(tombstonesOut), { recursive: true })

    // Format via the same deterministic pretty-printer the committed files
    // carry (matches lint-staged's oxfmt pass on src/**), so re-running the
    // bake never dirties the tree. JSON.parse ignores whitespace, so this
    // has no runtime effect.
    fs.writeFileSync(pokemonOut, formatDataJson(pokemon))
    fs.writeFileSync(itemsOut, formatDataJson(items))
    fs.writeFileSync(habitatsOut, formatDataJson(habitats))
    fs.writeFileSync(
      adjacencyOut,
      formatDataJson({ names: adjacency.names, size: adjacency.size, data: adjacency.data }),
    )
    fs.writeFileSync(tombstonesOut, formatDataJson(tombstones))

    const tombstoneCount = Object.values(tombstones).reduce(
      (sum, map) => sum + Object.keys(map).length,
      0,
    )
    return {
      pokemonCount: pokemon.names.length,
      itemCount: Object.keys(items.itemDetailsByName).length,
      favoriteCount: Object.keys(items.itemsByFavorite).length,
      recipeCount: Object.keys(items.recipeByItem).length,
      habitatCount: Object.keys(habitats).length,
      habitatSpawnCount: Object.values(habitats).reduce((sum, h) => sum + h.pokemon.length, 0),
      adjacencySize: adjacency.size,
      adjacencyEdgeCount: adjacency.edgeCount,
      adjacencyBytes: fs.statSync(adjacencyOut).size,
      tombstoneCount,
      paths: { pokemonOut, itemsOut, habitatsOut, adjacencyOut, tombstonesOut },
    }
  } finally {
    db.close()
  }
}

function main() {
  const stats = bake(DEFAULT_DB_PATH)
  console.log(`pokemon.json: ${stats.pokemonCount} pokemon`)
  console.log(
    `items.json: ${stats.itemCount} items, ` +
      `${stats.favoriteCount} favorites, ` +
      `${stats.recipeCount} recipes`,
  )
  console.log(
    `habitats.json: ${stats.habitatCount} habitats, ${stats.habitatSpawnCount} spawn rows`,
  )
  console.log(
    `adjacency.json: ${stats.adjacencySize}x${stats.adjacencySize} matrix, ` +
      `${stats.adjacencyEdgeCount} edges, ${(stats.adjacencyBytes / 1024).toFixed(0)} KiB on disk`,
  )
  console.log(`tombstones.json: ${stats.tombstoneCount} rename tombstone(s)`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? '')) {
  main()
}
