import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '../public')

function normalizeTitleCase(s) {
  return s
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

// Open database
const dbPath = path.join(publicDir, 'pokehousing.sqlite')
const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

// Build lookup of existing items: lowercase name → { id, name }
const existingItems = new Map()
for (const row of db.prepare('SELECT id, name FROM items').all()) {
  existingItems.set(row.name.toLowerCase(), { id: row.id, name: row.name })
}
console.log(`Existing items in DB: ${existingItems.size}`)

// Read JSONL
const jsonlPath = path.join(publicDir, 'items.jsonl')
const lines = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n')
const jsonlItems = lines.map((line) => JSON.parse(line))
console.log(`Items in JSONL: ${jsonlItems.length}`)

// Prepared statements
const updateItem = db.prepare(
  'UPDATE items SET category = ?, picture_path = ?, flavor_text = ? WHERE id = ?'
)
const insertItem = db.prepare(
  'INSERT INTO items (name, category, picture_path, flavor_text) VALUES (?, ?, ?, ?)'
)
const insertRecipe = db.prepare(
  'INSERT INTO item_recipe (item_id, ingredient_id, count) VALUES (?, ?, ?)'
)

let updated = 0
let inserted = 0

// Process items — update existing, insert new
const processItems = db.transaction(() => {
  for (const item of jsonlItems) {
    const key = item.name.toLowerCase()
    const existing = existingItems.get(key)

    if (existing) {
      updateItem.run(item.category || null, item.picture || null, item.flavor_text || null, existing.id)
      updated++
    } else {
      const titleName = normalizeTitleCase(item.name)
      const info = insertItem.run(titleName, item.category || null, item.picture || null, item.flavor_text || null)
      existingItems.set(key, { id: Number(info.lastInsertRowid), name: titleName })
      inserted++
    }
  }
})
processItems()
console.log(`Updated: ${updated}, Inserted: ${inserted}`)

// Process recipes
let recipesInserted = 0
const warnings = []

const processRecipes = db.transaction(() => {
  for (const item of jsonlItems) {
    if (!item.recipe || item.recipe.length === 0) continue

    const itemEntry = existingItems.get(item.name.toLowerCase())
    if (!itemEntry) continue

    for (const ingredient of item.recipe) {
      const ingredientEntry = existingItems.get(ingredient.item.toLowerCase())
      if (!ingredientEntry) {
        warnings.push(`Ingredient not found: "${ingredient.item}" (recipe for "${item.name}")`)
        continue
      }
      insertRecipe.run(itemEntry.id, ingredientEntry.id, ingredient.number)
      recipesInserted++
    }
  }
})
processRecipes()

console.log(`Recipes inserted: ${recipesInserted}`)
if (warnings.length > 0) {
  console.log(`Warnings (${warnings.length}):`)
  for (const w of warnings) {
    console.log(`  ⚠ ${w}`)
  }
}

// Summary
const totalItems = db.prepare('SELECT COUNT(*) as c FROM items').get().c
const withPicture = db.prepare('SELECT COUNT(*) as c FROM items WHERE picture_path IS NOT NULL').get().c
const totalRecipes = db.prepare('SELECT COUNT(*) as c FROM item_recipe').get().c
console.log(`\n✓ Done`)
console.log(`  Items total: ${totalItems} (${withPicture} with picture_path)`)
console.log(`  Recipes: ${totalRecipes}`)

db.close()
