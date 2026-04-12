import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '../public')
const srcDir = path.join(__dirname, '../src')

// Utility: normalize to lowercase
function normalizeLowercase(s) {
  return s.toLowerCase()
}

// Utility: normalize to Title Case
function normalizeTitleCase(s) {
  return s
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

// Step A: Load base data
console.log('Loading pokemon_favorites.json...')
const pokemonFavoritesPath = path.join(publicDir, 'pokemon_favorites.json')
const pokemonFavoritesRaw = JSON.parse(fs.readFileSync(pokemonFavoritesPath, 'utf-8'))

console.log('Loading items_by_favorite.json...')
const itemsByFavoritePath = path.join(srcDir, 'items_by_favorite.json')
const itemsByFavoriteRaw = JSON.parse(fs.readFileSync(itemsByFavoritePath, 'utf-8'))

// Initialize database
console.log('Creating SQLite database...')
const dbPath = path.join(publicDir, 'pokehousing.sqlite')
const db = new Database(dbPath)

// Enable foreign keys
db.pragma('foreign_keys = ON')

// Create schema (IF NOT EXISTS to allow rebuilding)
db.exec(`
CREATE TABLE IF NOT EXISTS favorites (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS pokemon (
  id         INTEGER PRIMARY KEY,
  name       TEXT UNIQUE NOT NULL,
  image_path TEXT,
  habitat    TEXT
);

CREATE TABLE IF NOT EXISTS pokemon_favorites (
  pokemon_id    INTEGER NOT NULL REFERENCES pokemon(id),
  favorite_name TEXT    NOT NULL REFERENCES favorites(name),
  PRIMARY KEY (pokemon_id, favorite_name)
);

CREATE TABLE IF NOT EXISTS items (
  id           INTEGER PRIMARY KEY,
  name         TEXT UNIQUE NOT NULL,
  category     TEXT,
  picture_path TEXT,
  flavor_text  TEXT,
  tag          TEXT
);

CREATE TABLE IF NOT EXISTS item_favorites (
  item_id       INTEGER NOT NULL REFERENCES items(id),
  favorite_name TEXT    NOT NULL REFERENCES favorites(name),
  PRIMARY KEY (item_id, favorite_name)
);

CREATE TABLE IF NOT EXISTS item_recipe (
  item_id       INTEGER NOT NULL REFERENCES items(id),
  ingredient_id INTEGER NOT NULL REFERENCES items(id),
  count         INTEGER NOT NULL,
  PRIMARY KEY (item_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS adjacency (
  pokemon_a INTEGER NOT NULL REFERENCES pokemon(id),
  pokemon_b INTEGER NOT NULL REFERENCES pokemon(id),
  score     INTEGER,
  PRIMARY KEY (pokemon_a, pokemon_b)
);
`)

// Clear existing data (temporarily disable FK constraints)
console.log('Clearing existing data...')
db.pragma('foreign_keys = OFF')
db.exec(`
DELETE FROM item_favorites;
DELETE FROM pokemon_favorites;
DELETE FROM items;
DELETE FROM pokemon;
DELETE FROM favorites;
DELETE FROM adjacency;
`)
db.pragma('foreign_keys = ON')

// Collect all favorite names from both sources and normalize them
const allFavoriteNames = new Set()
for (const pokemonEntry of Object.values(pokemonFavoritesRaw)) {
  for (const fav of pokemonEntry.favorites || []) {
    allFavoriteNames.add(normalizeLowercase(fav))
  }
}
for (const favName of Object.keys(itemsByFavoriteRaw)) {
  allFavoriteNames.add(normalizeLowercase(favName))
}

// Insert favorites
console.log('Inserting favorites...')
const insertFavorite = db.prepare('INSERT INTO favorites (name) VALUES (?)')
for (const favName of allFavoriteNames) {
  insertFavorite.run(favName)
}

// Insert pokemon
console.log('Inserting pokemon...')
const insertPokemon = db.prepare(
  'INSERT INTO pokemon (name, image_path, habitat) VALUES (?, ?, ?)'
)
const pokemonNameMap = new Map() // name -> id
let pokemonId = 1
for (const [pokemonName, entry] of Object.entries(pokemonFavoritesRaw)) {
  const normalizedName = normalizeTitleCase(pokemonName)
  const normalizedHabitat = entry.habitat ? normalizeLowercase(entry.habitat) : null
  const imagePath = entry.image ? normalizeTitleCase(entry.image) : null
  insertPokemon.run(normalizedName, imagePath, normalizedHabitat)
  pokemonNameMap.set(normalizedName, pokemonId)
  pokemonId++
}

// Insert pokemon_favorites
console.log('Inserting pokemon_favorites...')
const insertPokemonFavorite = db.prepare(
  'INSERT INTO pokemon_favorites (pokemon_id, favorite_name) VALUES (?, ?)'
)
for (const [pokemonName, entry] of Object.entries(pokemonFavoritesRaw)) {
  const normalizedName = normalizeTitleCase(pokemonName)
  const pId = pokemonNameMap.get(normalizedName)
  if (!pId) throw new Error(`Pokemon not found: ${normalizedName}`)
  for (const fav of entry.favorites || []) {
    const normalizedFav = normalizeLowercase(fav)
    insertPokemonFavorite.run(pId, normalizedFav)
  }
}

// Insert items
console.log('Inserting items...')
const insertItem = db.prepare(
  'INSERT INTO items (name, category, picture_path, flavor_text) VALUES (?, ?, ?, ?)'
)
const itemNameMap = new Map() // name -> id
let itemId = 1

// Collect all items from itemsByFavorite
const allItems = new Set()
for (const items of Object.values(itemsByFavoriteRaw)) {
  for (const item of items) {
    allItems.add(item)
  }
}

for (const itemName of allItems) {
  const normalizedName = normalizeTitleCase(itemName)
  insertItem.run(normalizedName, null, null, null)
  itemNameMap.set(normalizedName, itemId)
  itemId++
}

// Insert item_favorites
console.log('Inserting item_favorites...')
const insertItemFavorite = db.prepare(
  'INSERT INTO item_favorites (item_id, favorite_name) VALUES (?, ?)'
)
for (const [favName, items] of Object.entries(itemsByFavoriteRaw)) {
  const normalizedFav = normalizeLowercase(favName)
  for (const itemName of items) {
    const normalizedItemName = normalizeTitleCase(itemName)
    const iId = itemNameMap.get(normalizedItemName)
    if (!iId) throw new Error(`Item not found: ${normalizedItemName}`)
    insertItemFavorite.run(iId, normalizedFav)
  }
}

// Compute adjacency using SQL
console.log('Computing adjacency scores...')
db.exec(`
CREATE VIEW adjacency_scores AS
WITH shared AS (
  SELECT pf1.pokemon_id AS a, pf2.pokemon_id AS b, COUNT(*) AS shared_count
  FROM pokemon_favorites pf1
  JOIN pokemon_favorites pf2 ON pf1.favorite_name = pf2.favorite_name AND pf1.pokemon_id < pf2.pokemon_id
  GROUP BY pf1.pokemon_id, pf2.pokemon_id
),
all_pairs AS (
  SELECT p1.id AS a, p2.id AS b, p1.habitat AS hab_a, p2.habitat AS hab_b,
         COALESCE(s.shared_count, 0) AS shared_count
  FROM pokemon p1 JOIN pokemon p2 ON p1.id < p2.id
  LEFT JOIN shared s ON s.a = p1.id AND s.b = p2.id
)
SELECT a AS pokemon_a, b AS pokemon_b,
  CASE
    WHEN hab_a IS NOT NULL AND hab_b IS NOT NULL AND (
      (hab_a = 'dark'   AND hab_b = 'bright') OR (hab_a = 'bright' AND hab_b = 'dark')  OR
      (hab_a = 'cool'   AND hab_b = 'warm')   OR (hab_a = 'warm'   AND hab_b = 'cool')  OR
      (hab_a = 'dry'    AND hab_b = 'humid')  OR (hab_a = 'humid'  AND hab_b = 'dry')
    ) THEN NULL
    WHEN hab_a IS NOT NULL AND hab_a = hab_b THEN shared_count + 1
    ELSE shared_count
  END AS score
FROM all_pairs;
`)

// Materialize adjacency table
db.exec(`
INSERT INTO adjacency (pokemon_a, pokemon_b, score)
SELECT pokemon_a, pokemon_b, score FROM adjacency_scores
WHERE score IS NULL OR score > 0;
`)

// Get stats
const favCount = db.prepare('SELECT COUNT(*) as count FROM favorites').get().count
const pokemonCount = db.prepare('SELECT COUNT(*) as count FROM pokemon').get().count
const pokemonFavCount = db.prepare('SELECT COUNT(*) as count FROM pokemon_favorites').get().count
const itemCount = db.prepare('SELECT COUNT(*) as count FROM items').get().count
const itemFavCount = db.prepare('SELECT COUNT(*) as count FROM item_favorites').get().count
const adjCount = db.prepare('SELECT COUNT(*) as count FROM adjacency').get().count

console.log(`✓ Database created: ${dbPath}`)
console.log(`  - Favorites: ${favCount}`)
console.log(`  - Pokemon: ${pokemonCount}`)
console.log(`  - Pokemon Favorites: ${pokemonFavCount}`)
console.log(`  - Items: ${itemCount}`)
console.log(`  - Item Favorites: ${itemFavCount}`)
console.log(`  - Adjacency pairs: ${adjCount}`)

const stats = fs.statSync(dbPath)
console.log(`  - File size: ${Math.round(stats.size / 1024)} KB`)

db.close()
console.log('✓ Done')
