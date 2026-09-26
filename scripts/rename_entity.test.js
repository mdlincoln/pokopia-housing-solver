// Unit tests for scripts/rename_entity.mjs.
//
// Stdlib only (node:test + node:assert + node:sqlite). Each test seeds a temp
// file SQLite DB from scripts/db.sql (the established harvest-test pattern),
// so foreign keys are live exactly as in production. One test pins the
// committed src/pokehousing.sqlite to carrying the tombstone tables — it
// fails if the DB is left un-migrated.

import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import { ensureSchema, renameEntity, tombstoneDdlStatements } from './rename_entity.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DB_SQL_PATH = path.join(HERE, 'db.sql')
const COMMITTED_DB_PATH = path.join(HERE, '..', 'src', 'pokehousing.sqlite')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-entity-'))
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  return tmp
}

function seedTestDb(dbPath) {
  const schemaSql = fs.readFileSync(DB_SQL_PATH, 'utf8')
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys=ON')
  db.exec(schemaSql)
  db.close()
}

// A pre-migration DB: same schema minus the tombstone tables, so
// --ensure-schema / a real rename has real DDL work to do.
function seedPreMigrationDb(dbPath) {
  let schemaSql = fs.readFileSync(DB_SQL_PATH, 'utf8')
  for (const name of ['pokemon_tombstones', 'item_tombstones', 'habitat_tombstones']) {
    const re = new RegExp(`CREATE\\s+TABLE\\s+${name}\\s+\\([\\s\\S]*?\\);\\n?`, 'i')
    schemaSql = schemaSql.replace(re, '')
  }
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys=ON')
  db.exec(schemaSql)
  db.close()
}

function openDb(dbPath) {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys=ON')
  return db
}

const POKEMON_SEED_SQL = [
  "INSERT INTO habitats (habitat, opposite) VALUES ('Cool', 'Warm')",
  "INSERT INTO habitats (habitat, opposite) VALUES ('Warm', 'Cool')",
  "INSERT INTO pokemon (id, name, image_path, habitat) VALUES (1, 'Alpha', 'images/a.png', 'Cool')",
  "INSERT INTO pokemon (id, name, image_path, habitat) VALUES (2, 'Beta', 'images/b.png', 'Warm')",
  "INSERT INTO habitat_entries (id, number, name, category) VALUES (10, 1, 'Forest', 'main')",
  "INSERT INTO habitat_entries (id, number, name, category) VALUES (11, 2, 'Cave', 'main')",
  "INSERT INTO habitat_recipe (habitat_id, item_name, quantity) VALUES (10, 'Lumber', 2)",
  "INSERT INTO habitat_recipe (habitat_id, item_name, quantity) VALUES (11, 'Lumber', 1)",
  "INSERT INTO items (id, name) VALUES (1, 'Lumber')",
  "INSERT INTO items (id, name) VALUES (2, 'Stone')",
  // Alpha spawns in Forest (10) with one row in each spawn join table.
  "INSERT INTO habitat_pokemon (habitat_id, pokemon_name, rarity) VALUES (10, 'Alpha', 'Common')",
  "INSERT INTO habitat_pokemon_location (habitat_id, pokemon_name, location) VALUES (10, 'Alpha', 'Grass')",
  "INSERT INTO habitat_pokemon_time (habitat_id, pokemon_name, time) VALUES (10, 'Alpha', 'Morning')",
  "INSERT INTO habitat_pokemon_weather (habitat_id, pokemon_name, weather) VALUES (10, 'Alpha', 'Sun')",
  // A spawn-only roster name with no catalog row (like Porygon-Z).
  "INSERT INTO habitat_pokemon (habitat_id, pokemon_name, rarity) VALUES (11, 'Spanion', 'Rare')",
].join('; ')

function seedPokemonFixture(dbPath) {
  const db = openDb(dbPath)
  // Circular habitats.opposite FKs are only deferred inside a transaction.
  db.exec('BEGIN')
  db.exec(POKEMON_SEED_SQL)
  db.exec('COMMIT')
  db.close()
}

// ---------------------------------------------------------------------------
// AC.1 — schema
// ---------------------------------------------------------------------------

test('--ensure-schema creates all three tombstone tables on a pre-migration DB', (t) => {
  const tmp = makeTempDir(t)
  const dbPath = path.join(tmp, 'test.db')
  seedPreMigrationDb(dbPath)

  const db = openDb(dbPath)
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name LIKE '%_tombstones'").get().c,
    0,
  )
  db.close()

  ensureSchema(dbPath)

  const after = openDb(dbPath)
  const names = after
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%_tombstones' ORDER BY name",
    )
    .all()
    .map((r) => r.name)
  after.close()
  assert.deepStrictEqual(names, ['habitat_tombstones', 'item_tombstones', 'pokemon_tombstones'])
})

test('--ensure-schema is a no-op when the tables already exist', (t) => {
  const tmp = makeTempDir(t)
  const dbPath = path.join(tmp, 'test.db')
  seedTestDb(dbPath)

  ensureSchema(dbPath)
  ensureSchema(dbPath) // must not throw

  const db = openDb(dbPath)
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name LIKE '%_tombstones'").get().c,
    3,
  )
  db.close()
})

test('tombstoneDdlStatements parses all three tables from db.sql', () => {
  const statements = tombstoneDdlStatements()
  assert.strictEqual(statements.length, 3)
  assert.ok(statements.every((s) => s.toUpperCase().startsWith('CREATE TABLE IF NOT EXISTS')))
  assert.ok(statements.some((s) => s.includes('pokemon_tombstones')))
  assert.ok(statements.some((s) => s.includes('item_tombstones')))
  assert.ok(statements.some((s) => s.includes('habitat_tombstones')))
})

test('the committed src/pokehousing.sqlite carries all three tombstone tables', () => {
  const db = new DatabaseSync(COMMITTED_DB_PATH, { readOnly: true })
  try {
    for (const name of ['pokemon_tombstones', 'item_tombstones', 'habitat_tombstones']) {
      const row = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name)
      assert.ok(row !== undefined, `committed DB is missing tombstone table: ${name}`)
    }
  } finally {
    db.close()
  }
})

// ---------------------------------------------------------------------------
// AC.2 — transactional rename + cascade
// ---------------------------------------------------------------------------

test('pokemon rename cascades through habitat_pokemon + the three join tables under foreign_keys=ON', (t) => {
  const tmp = makeTempDir(t)
  const dbPath = path.join(tmp, 'test.db')
  seedTestDb(dbPath)
  seedPokemonFixture(dbPath)

  const report = renameEntity(dbPath, 'pokemon', 'Alpha', 'Gamma')
  assert.strictEqual(report.dryRun, false)
  assert.deepStrictEqual(report.updates, [
    { table: 'habitat_pokemon_location', updated: 1 },
    { table: 'habitat_pokemon_time', updated: 1 },
    { table: 'habitat_pokemon_weather', updated: 1 },
    { table: 'habitat_pokemon', updated: 1 },
    { table: 'pokemon', updated: 1 },
  ])

  const db = openDb(dbPath)
  try {
    // Entity renamed, catalog shape intact.
    assert.ok(db.prepare("SELECT 1 FROM pokemon WHERE name = 'Gamma'").get() !== undefined)
    assert.ok(db.prepare("SELECT 1 FROM pokemon WHERE name = 'Alpha'").get() === undefined)
    // Cascades visible in every spawn surface.
    assert.strictEqual(
      db.prepare("SELECT rarity FROM habitat_pokemon WHERE pokemon_name = 'Gamma'").get().rarity,
      'Common',
    )
    for (const joinTable of [
      'habitat_pokemon_location',
      'habitat_pokemon_time',
      'habitat_pokemon_weather',
    ]) {
      assert.strictEqual(
        db.prepare(`SELECT COUNT(*) AS c FROM ${joinTable} WHERE pokemon_name = 'Gamma'`).get().c,
        1,
        joinTable,
      )
      assert.strictEqual(
        db.prepare(`SELECT COUNT(*) AS c FROM ${joinTable} WHERE pokemon_name = 'Alpha'`).get().c,
        0,
        joinTable,
      )
    }
    // Tombstone row inserted, FK pointing at the surviving id.
    const tomb = db
      .prepare("SELECT pokemon_id, renamed_at FROM pokemon_tombstones WHERE old_name = 'Alpha'")
      .get()
    assert.ok(tomb !== undefined, 'tombstone row missing')
    assert.strictEqual(
      tomb.pokemon_id,
      db.prepare("SELECT id FROM pokemon WHERE name = 'Gamma'").get().id,
    )
    assert.ok(tomb.renamed_at)
    // Untouched neighbor sane.
    assert.ok(db.prepare("SELECT 1 FROM pokemon WHERE name = 'Beta'").get() !== undefined)
    assert.strictEqual(
      db.prepare("SELECT rarity FROM habitat_pokemon WHERE pokemon_name = 'Spanion'").get().rarity,
      'Rare',
    )
  } finally {
    db.close()
  }
})

test('item rename cascades habitat_recipe.item_name', (t) => {
  const tmp = makeTempDir(t)
  const dbPath = path.join(tmp, 'test.db')
  seedTestDb(dbPath)
  seedPokemonFixture(dbPath)

  const report = renameEntity(dbPath, 'item', 'Lumber', 'Plank')
  assert.deepStrictEqual(report.updates, [
    { table: 'habitat_recipe', updated: 2 },
    { table: 'items', updated: 1 },
  ])

  const db = openDb(dbPath)
  try {
    assert.strictEqual(
      db.prepare("SELECT COUNT(*) AS c FROM habitat_recipe WHERE item_name = 'Plank'").get().c,
      2,
    )
    assert.strictEqual(
      db.prepare("SELECT COUNT(*) AS c FROM habitat_recipe WHERE item_name = 'Lumber'").get().c,
      0,
    )
    const tomb = db.prepare("SELECT item_id FROM item_tombstones WHERE old_name = 'Lumber'").get()
    assert.strictEqual(
      tomb.item_id,
      db.prepare("SELECT id FROM items WHERE name = 'Plank'").get().id,
    )
    // Unrelated item untouched.
    assert.ok(db.prepare("SELECT 1 FROM items WHERE name = 'Stone'").get() !== undefined)
  } finally {
    db.close()
  }
})

test('habitat rename updates only habitat_entries (others reference the id)', (t) => {
  const tmp = makeTempDir(t)
  const dbPath = path.join(tmp, 'test.db')
  seedTestDb(dbPath)
  seedPokemonFixture(dbPath)

  const report = renameEntity(dbPath, 'habitat', 'Forest', 'Woods')
  assert.deepStrictEqual(report.updates, [{ table: 'habitat_entries', updated: 1 }])

  const db = openDb(dbPath)
  try {
    assert.strictEqual(
      db.prepare("SELECT id FROM habitat_entries WHERE name = 'Woods'").get().id,
      10,
    )
    // Children intact through the id FK.
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) AS c FROM habitat_pokemon WHERE habitat_id = 10').get().c,
      1,
    )
    const tomb = db
      .prepare("SELECT habitat_id FROM habitat_tombstones WHERE old_name = 'Forest'")
      .get()
    assert.strictEqual(tomb.habitat_id, 10)
  } finally {
    db.close()
  }
})

test('chained rename A->B then B->C leaves two tombstone rows', (t) => {
  const tmp = makeTempDir(t)
  const dbPath = path.join(tmp, 'test.db')
  seedTestDb(dbPath)
  seedPokemonFixture(dbPath)

  renameEntity(dbPath, 'pokemon', 'Alpha', 'Gamma')
  renameEntity(dbPath, 'pokemon', 'Gamma', 'Delta')

  const db = openDb(dbPath)
  try {
    const rows = db
      .prepare('SELECT old_name, pokemon_id FROM pokemon_tombstones ORDER BY old_name')
      .all()
    assert.deepStrictEqual(
      rows.map((r) => r.old_name),
      ['Alpha', 'Gamma'],
    )
    // Both tombstones FK to the same surviving entity id.
    assert.strictEqual(rows[0].pokemon_id, rows[1].pokemon_id)
    assert.strictEqual(
      rows[0].pokemon_id,
      db.prepare("SELECT id FROM pokemon WHERE name = 'Delta'").get().id,
    )
  } finally {
    db.close()
  }
})

test('--to may reuse a tombstone old_name (warns; live catalog stays authoritative)', (t) => {
  const tmp = makeTempDir(t)
  const dbPath = path.join(tmp, 'test.db')
  seedTestDb(dbPath)
  seedPokemonFixture(dbPath)

  // Alpha -> Gamma, then Beta -> Alpha (recycling the tombstoned name).
  renameEntity(dbPath, 'pokemon', 'Alpha', 'Gamma')
  const report = renameEntity(dbPath, 'pokemon', 'Beta', 'Alpha')
  assert.ok(
    report.warnings.some((w) => w.includes('tombstone')),
    JSON.stringify(report.warnings),
  )

  const db = openDb(dbPath)
  try {
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM pokemon_tombstones').get().c, 2)
    assert.ok(db.prepare("SELECT 1 FROM pokemon WHERE name = 'Alpha'").get() !== undefined)
  } finally {
    db.close()
  }
})

test('--dry-run reports the plan and writes nothing', (t) => {
  const tmp = makeTempDir(t)
  const dbPath = path.join(tmp, 'test.db')
  seedPreMigrationDb(dbPath)
  seedPokemonFixture(dbPath)

  const before = fs.readFileSync(dbPath)

  const report = renameEntity(dbPath, 'pokemon', 'Alpha', 'Gamma', { dryRun: true })
  assert.strictEqual(report.dryRun, true)
  assert.deepStrictEqual(
    report.updates.map((u) => u.table),
    [
      'habitat_pokemon_location',
      'habitat_pokemon_time',
      'habitat_pokemon_weather',
      'habitat_pokemon',
      'pokemon',
    ],
  )
  assert.ok(
    report.updates.every((u) => u.updated > 0),
    JSON.stringify(report.updates),
  )
  assert.ok(report.warnings.some((w) => w.includes('dry-run')))

  const db = openDb(dbPath)
  try {
    assert.ok(db.prepare("SELECT 1 FROM pokemon WHERE name = 'Alpha'").get() !== undefined)
    assert.ok(db.prepare("SELECT 1 FROM pokemon WHERE name = 'Gamma'").get() === undefined)
    // No tombstone DDL, no tombstone row.
    assert.strictEqual(
      db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name LIKE '%_tombstones'").get().c,
      0,
    )
  } finally {
    db.close()
  }
  assert.ok(before.equals(fs.readFileSync(dbPath)), 'dry-run must not write the DB file')
})

// ---------------------------------------------------------------------------
// Validation rejections
// ---------------------------------------------------------------------------

test('unknown --type is rejected', () => {
  assert.throws(() => renameEntity(':memory:', 'sock', 'A', 'B'), /Unknown --type 'sock'/)
})

test('--from must exist byte-exact (case-insensitive hint on near match)', (t) => {
  const tmp = makeTempDir(t)
  const dbPath = path.join(tmp, 'test.db')
  seedTestDb(dbPath)
  seedPokemonFixture(dbPath)

  assert.throws(() => renameEntity(dbPath, 'pokemon', 'Nonexistent', 'X'), /does not exist/)
  assert.throws(
    () => renameEntity(dbPath, 'pokemon', 'alpha', 'X'),
    /case-insensitive match: 'Alpha'/,
  )
})

test('--to must be non-empty and not collide (exact or case-insensitive)', (t) => {
  const tmp = makeTempDir(t)
  const dbPath = path.join(tmp, 'test.db')
  seedTestDb(dbPath)
  seedPokemonFixture(dbPath)

  assert.throws(() => renameEntity(dbPath, 'pokemon', 'Alpha', ''), /non-empty/)
  assert.throws(() => renameEntity(dbPath, 'pokemon', 'Alpha', '   '), /non-empty/)
  assert.throws(() => renameEntity(dbPath, 'pokemon', 'Alpha', 'Alpha'), /already exists/)
  assert.throws(() => renameEntity(dbPath, 'pokemon', 'Alpha', 'Beta'), /already exists/)
  assert.throws(() => renameEntity(dbPath, 'pokemon', 'Alpha', 'ALPHA'), /case-insensitively/)
  assert.throws(() => renameEntity(dbPath, 'pokemon', 'Alpha', 'beta'), /case-insensitively/)
})

test('--from already being a tombstone old_name is refused', (t) => {
  const tmp = makeTempDir(t)
  const dbPath = path.join(tmp, 'test.db')
  seedTestDb(dbPath)
  seedPokemonFixture(dbPath)

  // Alpha -> Gamma, then a new entity legitimately occupies the recycled
  // name 'Alpha'. Renaming that new entity must refuse: the tombstone maps
  // 'Alpha' to Gamma's id already.
  renameEntity(dbPath, 'pokemon', 'Alpha', 'Gamma')
  const db = openDb(dbPath)
  db.exec(
    "INSERT INTO pokemon (id, name, image_path, habitat) VALUES (3, 'Alpha', 'images/c.png', 'Cool')",
  )
  db.close()

  assert.throws(
    () => renameEntity(dbPath, 'pokemon', 'Alpha', 'Delta'),
    /already has a tombstone row/,
  )
})

test('pokemon rename rejected when --to is already a spawn-only roster name in a shared habitat', (t) => {
  const tmp = makeTempDir(t)
  const dbPath = path.join(tmp, 'test.db')
  seedTestDb(dbPath)
  seedPokemonFixture(dbPath)

  // Pre-flight: 'Spanion' occupies habitat 11 only; Alpha spawns in 10, so a
  // rename to Spanion would NOT collide.
  assert.doesNotThrow(() => {
    renameEntity(dbPath, 'pokemon', 'Alpha', 'Spanion', { dryRun: true })
  })

  // Give Alpha a spawn in the same habitat as Spanion -> collision.
  const db = openDb(dbPath)
  db.exec(
    "INSERT INTO habitat_pokemon (habitat_id, pokemon_name, rarity) VALUES (11, 'Alpha', 'Common')",
  )
  db.close()

  assert.throws(
    () => renameEntity(dbPath, 'pokemon', 'Alpha', 'Spanion', { dryRun: true }),
    /already appears as a habitat_pokemon spawn name/,
  )
  // And the real run must also refuse before any write.
  assert.throws(
    () => renameEntity(dbPath, 'pokemon', 'Alpha', 'Spanion'),
    /already appears as a habitat_pokemon spawn name/,
  )
})

test('item rename rejected on a habitat_recipe composite-key collision', (t) => {
  const tmp = makeTempDir(t)
  const dbPath = path.join(tmp, 'test.db')
  seedTestDb(dbPath)
  seedPokemonFixture(dbPath)

  const db = openDb(dbPath)
  // Habitat 10's recipe contains both Lumber and a stray 'Plank' text value.
  db.exec("INSERT INTO habitat_recipe (habitat_id, item_name, quantity) VALUES (10, 'Plank', 1)")
  db.close()

  assert.throws(
    () => renameEntity(dbPath, 'item', 'Lumber', 'Plank', { dryRun: true }),
    /habitat_recipe/,
  )
})

test('a failed rename leaves the DB untouched (transaction rollback)', (t) => {
  const tmp = makeTempDir(t)
  const dbPath = path.join(tmp, 'test.db')
  seedTestDb(dbPath)
  seedPokemonFixture(dbPath)

  assert.throws(() => renameEntity(dbPath, 'pokemon', 'Alpha', 'Beta'), /already exists/)

  const db = openDb(dbPath)
  try {
    assert.ok(db.prepare("SELECT 1 FROM pokemon WHERE name = 'Alpha'").get() !== undefined)
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM pokemon_tombstones').get().c, 0)
  } finally {
    db.close()
  }
})
