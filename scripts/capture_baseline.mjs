// Phase 0 baseline capture for the sql.js → baked-data refactor.
//
// Runs the pre-refactor query logic directly against public/pokehousing.sqlite
// with node:sqlite (mirroring the SQL in src/queries.ts exactly) and writes
// golden fixtures to src/__tests__/fixtures/. After the refactor, a Vitest
// test compares the new baked-data implementations against these snapshots
// byte-for-byte (AC.7).
//
// Inputs are recorded explicitly in each fixture file. Do NOT regenerate these
// fixtures after the refactor — regenerate only via git history of this script
// run against the pre-refactor implementation.

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DEFAULT_DB_PATH, PROJECT_ROOT } from './harvest_lib.js'

const db = new DatabaseSync(DEFAULT_DB_PATH, { readOnly: true })

// ---------------------------------------------------------------------------
// Item graph construction — mirrors loadItemGraph() in src/queries.ts exactly.
// ---------------------------------------------------------------------------

function loadItemGraph() {
  const itemDetailsByName = new Map()
  const itemRows = db
    .prepare(
      `SELECT i.name, i.category, i.flavor_text, i.picture_path, i.tag,
              CASE WHEN EXISTS(SELECT 1 FROM item_recipe r WHERE r.item_id = i.id) THEN 1 ELSE 0 END
       FROM items i
       ORDER BY i.id`,
    )
    .all()
  for (const row of itemRows) {
    const detail = {
      name: row.name,
      category: row.category ?? null,
      flavorText: row.flavor_text ?? null,
      picturePath: row.picture_path ?? null,
      tag: row.tag ?? null,
      isCraftable: row[Object.keys(row)[5]] === 1,
    }
    itemDetailsByName.set(detail.name, detail)
  }

  const itemsByFavorite = new Map()
  const favoritesByItem = new Map()
  const favoriteRows = db
    .prepare(
      `SELECT i.name AS item_name, IF.favorite_name
       FROM item_favorites IF
       JOIN items i ON i.id = IF.item_id
       ORDER BY i.id, IF.favorite_name`,
    )
    .all()
  for (const row of favoriteRows) {
    const itemName = row.item_name
    const favorite = row.favorite_name
    const detail = itemDetailsByName.get(itemName)
    if (!detail) continue
    if (!itemsByFavorite.has(favorite)) itemsByFavorite.set(favorite, [])
    itemsByFavorite.get(favorite).push(detail)
    if (!favoritesByItem.has(itemName)) favoritesByItem.set(itemName, [])
    favoritesByItem.get(itemName).push(favorite)
  }

  const recipeByItem = new Map()
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
    const itemName = row.item_name
    if (!recipeByItem.has(itemName)) recipeByItem.set(itemName, [])
    recipeByItem.get(itemName).push({
      ingredientName: row.ingredient_name,
      ingredientPicture: row.picture_path ?? null,
      count: row.count,
    })
  }

  return { itemDetailsByName, itemsByFavorite, favoritesByItem, recipeByItem }
}

// ---------------------------------------------------------------------------
// Pre-refactor implementations — copied verbatim in behavior from queries.ts.
// ---------------------------------------------------------------------------

function compareCodepoints(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

function favoriteCoverageColumnKey(favorite) {
  return `fav_${favorite}`
}

function recommendedItemsForHouse(graph, allFavorites) {
  const favoriteCounts = new Map()
  for (const favorite of allFavorites) {
    favoriteCounts.set(favorite, (favoriteCounts.get(favorite) ?? 0) + 1)
  }
  if (favoriteCounts.size === 0) return []

  const scored = new Map()
  for (const [favorite, count] of favoriteCounts) {
    for (const detail of graph.itemsByFavorite.get(favorite) ?? []) {
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
    const item = {
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

  results.sort(
    (a, b) =>
      b.score - a.score || b.covered - a.covered || compareCodepoints(a.item.name, b.item.name),
  )
  return results.map((result) => result.item)
}

function getAggregatedIngredients(graph, cartItems) {
  if (cartItems.length === 0) return []
  const totals = new Map()
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
  return Array.from(totals.values()).sort((a, b) => compareCodepoints(a.name, b.name))
}

// ---------------------------------------------------------------------------
// Capture.
// ---------------------------------------------------------------------------

const graph = loadItemGraph()

const RECOMMENDATION_INPUTS = [
  ['exercise'],
  ['exercise', 'cleanliness'],
  ['exercise', 'exercise', 'cleanliness'],
  ['lots of fire', 'group activities', 'stone stuff'],
  ['shiny stuff', 'colorful stuff', 'sweet treats'],
]

const AGGREGATED_INPUTS = [
  [{ name: 'Punching Bag', quantity: 3 }],
  [
    { name: 'Punching Bag', quantity: 1 },
    { name: 'Gaming Bed', quantity: 1 },
    { name: 'Wooden Table', quantity: 2 },
  ],
]

const fixturesDir = path.join(PROJECT_ROOT, 'src', '__tests__', 'fixtures')
fs.mkdirSync(fixturesDir, { recursive: true })

const recommendationsFixture = {
  _comment:
    'Golden snapshot of recommendedItemsForHouse captured pre-refactor by scripts/capture_baseline.mjs. Inputs below; expected arrays must match the post-refactor implementation exactly (AC.7). Do not regenerate after the refactor.',
  inputs: RECOMMENDATION_INPUTS,
  expected: RECOMMENDATION_INPUTS.map((favorites) => ({
    favorites,
    results: recommendedItemsForHouse(graph, favorites),
  })),
}

const aggregatedFixture = {
  _comment:
    'Golden snapshot of getAggregatedIngredients captured pre-refactor by scripts/capture_baseline.mjs. Inputs below; expected arrays must match the post-refactor implementation exactly (AC.7). Do not regenerate after the refactor.',
  inputs: AGGREGATED_INPUTS,
  expected: AGGREGATED_INPUTS.map((cartItems) => ({
    cartItems,
    results: getAggregatedIngredients(graph, cartItems),
  })),
}

fs.writeFileSync(
  path.join(fixturesDir, 'recommendations-golden.json'),
  JSON.stringify(recommendationsFixture, null, 2) + '\n',
)
fs.writeFileSync(
  path.join(fixturesDir, 'aggregated-golden.json'),
  JSON.stringify(aggregatedFixture, null, 2) + '\n',
)

console.log(`Wrote recommendations-golden.json (${recommendationsFixture.expected.length} inputs)`)
console.log(`Wrote aggregated-golden.json (${aggregatedFixture.expected.length} inputs)`)
