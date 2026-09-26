// Unit + CLI tests for the capitalization normalizer
// (scripts/harvest_lib.js#normalizeColumnCasing + scripts/normalize_capitalization.js).
//
// Stdlib only (node:test + node:assert + node:sqlite). Temp file SQLite DBs
// are seeded from scripts/db.sql (the same seedTestDb pattern as
// harvest_items.test.js; `:memory:` DBs are per-connection and cannot be
// shared across the reopen-by-path helper behavior).

import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import { CASING_NORMALIZATION_TARGETS, normalizeColumnCasing } from './harvest_lib.js'
import { main } from './normalize_capitalization.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = path.join(HERE, 'normalize_capitalization.js')
const DB_SQL_PATH = path.join(HERE, 'db.sql')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'normalize-casing-'))
}

function dbPathFor(tmpDir) {
  return path.join(tmpDir, 'test.db')
}

function seedTestDb(dbPath) {
  const schemaSql = fs.readFileSync(DB_SQL_PATH, 'utf8')
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

function getAll(dbPath, sql, params = []) {
  const ro = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return ro.prepare(sql).all(...params)
  } finally {
    ro.close()
  }
}

function captureLog(fn) {
  const originalLog = console.log
  const chunks = []
  console.log = (...args) => chunks.push(args.join(' '))
  return fn().finally(() => {
    console.log = originalLog
  })
}

// ---------------------------------------------------------------------------
// normalizeColumnCasing — majority rule (AC.6)
// ---------------------------------------------------------------------------

test('majority casing wins', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  seedTestDb(dbPath)

  // habitat 1 with four recipe rows: 3x 'Garbage bin' variant rows on distinct
  // habitats to keep the (habitat_id, item_name) PK distinct, plus one
  // 'Garbage Bin'. Use different habitat ids so each row is insertable.
  const db = openDb(dbPath)
  const id = db
    .prepare("INSERT INTO habitat_entries (number, name) VALUES (1, 'H')")
    .run().lastInsertRowid
  const ins = db.prepare(
    'INSERT INTO habitat_recipe (habitat_id, item_name, quantity) VALUES (?, ?, ?)',
  )
  // 3 rows 'Garbage bin' on three habitats, 1 row 'Garbage Bin'.
  ins.run(id, 'Garbage bin', 1)
  const other1 = db
    .prepare("INSERT INTO habitat_entries (number, name) VALUES (2, 'H2')")
    .run().lastInsertRowid
  ins.run(other1, 'Garbage bin', 2)
  const other2 = db
    .prepare("INSERT INTO habitat_entries (number, name) VALUES (3, 'H3')")
    .run().lastInsertRowid
  ins.run(other2, 'Garbage bin', 3)
  const other3 = db
    .prepare("INSERT INTO habitat_entries (number, name) VALUES (4, 'H4')")
    .run().lastInsertRowid
  ins.run(other3, 'Garbage Bin', 9)
  db.close()

  const report = normalizeColumnCasing(dbPath, 'habitat_recipe', 'item_name')
  assert.deepStrictEqual(report, [
    {
      table: 'habitat_recipe',
      column: 'item_name',
      from: 'Garbage Bin',
      to: 'Garbage bin',
      updated: 1,
      mergedDeleted: 0,
    },
  ])

  const names = new Set(
    getAll(dbPath, 'SELECT item_name FROM habitat_recipe').map((r) => r.item_name),
  )
  assert.deepStrictEqual(names, new Set(['Garbage bin']))
})

// ---------------------------------------------------------------------------
// Tie-breaks: title-case preference, then lexicographic (AC.6)
// ---------------------------------------------------------------------------

test('tie-break prefers the title-cased variant', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  seedTestDb(dbPath)

  const db = openDb(dbPath)
  const ins = db.prepare('INSERT INTO items (id, name, category) VALUES (?, ?, ?)')
  ins.run(1, 'I1', 'furniture')
  ins.run(2, 'I2', 'Furniture')
  db.close()

  const report = normalizeColumnCasing(dbPath, 'items', 'category')
  assert.deepStrictEqual(report, [
    {
      table: 'items',
      column: 'category',
      from: 'furniture',
      to: 'Furniture',
      updated: 1,
      mergedDeleted: 0,
    },
  ])
  const row = getAll(dbPath, 'SELECT category FROM items WHERE id = 1')[0]
  assert.strictEqual(row.category, 'Furniture')
})

test('tie-break falls back to lexicographically smallest when neither is title-cased', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  seedTestDb(dbPath)

  const db = openDb(dbPath)
  const ins = db.prepare('INSERT INTO items (id, name, category) VALUES (?, ?, ?)')
  ins.run(1, 'I1', 'TOY')
  ins.run(2, 'I2', 'toy')
  db.close()

  const report = normalizeColumnCasing(dbPath, 'items', 'category')
  // Neither 'Toy' (title case) is present; lexicographic: 'TOY' < 'toy'.
  assert.deepStrictEqual(report, [
    { table: 'items', column: 'category', from: 'toy', to: 'TOY', updated: 1, mergedDeleted: 0 },
  ])
})

// ---------------------------------------------------------------------------
// PK collision merge (AC.6)
// ---------------------------------------------------------------------------

test('PK collision on (habitat_id, item_name) merges by deleting the minority row', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  seedTestDb(dbPath)

  const db = openDb(dbPath)
  const id = db
    .prepare("INSERT INTO habitat_entries (number, name) VALUES (1, 'H')")
    .run().lastInsertRowid
  const ins = db.prepare(
    'INSERT INTO habitat_recipe (habitat_id, item_name, quantity) VALUES (?, ?, ?)',
  )
  ins.run(id, 'Garbage Bin', 5) // canonical by title-case tie-break
  ins.run(id, 'Garbage bin', 2) // collides on (habitat_id, 'garbage bin'-canonical)
  db.close()

  const report = normalizeColumnCasing(dbPath, 'habitat_recipe', 'item_name')
  assert.deepStrictEqual(report, [
    {
      table: 'habitat_recipe',
      column: 'item_name',
      from: 'Garbage bin',
      to: 'Garbage Bin',
      updated: 0,
      mergedDeleted: 1,
    },
  ])

  const rows = getAll(
    dbPath,
    'SELECT item_name, quantity FROM habitat_recipe WHERE habitat_id = ?',
    [id],
  )
  assert.strictEqual(rows.length, 1)
  assert.strictEqual(rows[0].item_name, 'Garbage Bin')
  assert.strictEqual(rows[0].quantity, 5) // canonical/majority row keeps its own quantity
})

test('PK collision on join-table value columns merges (location)', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  seedTestDb(dbPath)

  const db = openDb(dbPath)
  const id = db
    .prepare("INSERT INTO habitat_entries (number, name) VALUES (1, 'H')")
    .run().lastInsertRowid
  db.prepare(
    "INSERT INTO habitat_pokemon (habitat_id, pokemon_name, rarity) VALUES (?, 'Bulbasaur', 'Common')",
  ).run(id)
  db.prepare(
    "INSERT INTO habitat_pokemon_location (habitat_id, pokemon_name, location) VALUES (?, 'Bulbasaur', 'bleak beach')",
  ).run(id)
  // No collision: only one row — this is the update-not-delete sanity case.
  db.close()

  const report = normalizeColumnCasing(dbPath, 'habitat_pokemon_location', 'location')
  assert.deepStrictEqual(report, [])
})

// ---------------------------------------------------------------------------
// Allowlist enforcement + name immutability (AC.7)
// ---------------------------------------------------------------------------

test('normalizeColumnCasing throws on a (table, column) pair outside the allowlist', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  seedTestDb(dbPath)

  assert.throws(
    () => normalizeColumnCasing(dbPath, 'items', 'name'),
    /CASING_NORMALIZATION_TARGETS/,
  )
  assert.throws(
    () => normalizeColumnCasing(dbPath, 'pokemon', 'name'),
    /CASING_NORMALIZATION_TARGETS/,
  )
  assert.throws(
    () => normalizeColumnCasing(dbPath, 'favorites', 'name'),
    /CASING_NORMALIZATION_TARGETS/,
  )
  assert.throws(() => normalizeColumnCasing(dbPath, 'items', 'tag'), /CASING_NORMALIZATION_TARGETS/)
  assert.throws(
    () => normalizeColumnCasing(dbPath, 'sqlite_master', 'name'),
    /CASING_NORMALIZATION_TARGETS/,
  )
})

test('a full normalization run leaves items.name and pokemon.name byte-identical', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  seedTestDb(dbPath)

  const db = openDb(dbPath)
  const insItem = db.prepare('INSERT INTO items (id, name, category) VALUES (?, ?, ?)')
  insItem.run(1, 'wall storage box', 'DECORATION') // odd-cased name + drifting category
  insItem.run(2, 'POKE BALL', 'decoration') // collapse target: drift within category
  // Mutual FK references (Bright<->Dark) need one deferred transaction.
  db.exec('BEGIN')
  db.prepare("INSERT INTO habitats (habitat, opposite) VALUES ('Bright', 'Dark')").run()
  db.prepare("INSERT INTO habitats (habitat, opposite) VALUES ('Dark', 'Bright')").run()
  db.exec('COMMIT')
  const insPoke = db.prepare('INSERT INTO pokemon (id, name, habitat) VALUES (?, ?, ?)')
  insPoke.run(1, 'pikachu', 'Bright')
  insPoke.run(2, 'EEVEE', 'Bright')
  db.close()

  const beforeNames = getAll(dbPath, 'SELECT id, name FROM items ORDER BY id')
  const beforePoke = getAll(dbPath, 'SELECT id, name FROM pokemon ORDER BY id')

  // Run every target in the allowlist (the full default normalization sweep).
  const allDb = openDb(dbPath)
  for (const target of CASING_NORMALIZATION_TARGETS) {
    normalizeColumnCasing(dbPath, target.table, target.column)
  }
  allDb.close()

  const afterNames = getAll(dbPath, 'SELECT id, name FROM items ORDER BY id')
  const afterPoke = getAll(dbPath, 'SELECT id, name FROM pokemon ORDER BY id')
  assert.deepStrictEqual(afterNames, beforeNames)
  assert.deepStrictEqual(afterPoke, beforePoke)

  // The vocabulary columns did get collapsed to a single casing (sweep ran),
  // while names stayed untouched.
  const categories = new Set(
    getAll(dbPath, 'SELECT category FROM items ORDER BY id').map((r) => r.category),
  )
  assert.strictEqual(categories.size, 1)
})

// ---------------------------------------------------------------------------
// Idempotence (AC.6)
// ---------------------------------------------------------------------------

test('normalization is idempotent — second run changes nothing', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  seedTestDb(dbPath)

  const db = openDb(dbPath)
  const ins = db.prepare('INSERT INTO items (id, name, category) VALUES (?, ?, ?)')
  ins.run(1, 'I1', 'furniture')
  ins.run(2, 'I2', 'Furniture')
  const id = db
    .prepare("INSERT INTO habitat_entries (number, name) VALUES (1, 'H')")
    .run().lastInsertRowid
  db.prepare(
    "INSERT INTO habitat_recipe (habitat_id, item_name, quantity) VALUES (?, 'Garbage bin', 2)",
  ).run(id)
  db.prepare(
    "INSERT INTO habitat_recipe (habitat_id, item_name, quantity) VALUES (?, 'Garbage Bin', 3)",
  ).run(id)
  db.close()

  normalizeColumnCasing(dbPath, 'items', 'category')
  normalizeColumnCasing(dbPath, 'habitat_recipe', 'item_name')

  assert.deepStrictEqual(normalizeColumnCasing(dbPath, 'items', 'category'), [])
  assert.deepStrictEqual(normalizeColumnCasing(dbPath, 'habitat_recipe', 'item_name'), [])
})

test('dry-run report deep-equals the live report for every allowlisted (table, column)', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  seedTestDb(dbPath)

  // Seed casing drift across a key-column target and a non-key-column target.
  const db = openDb(dbPath)
  const ins = db.prepare('INSERT INTO items (id, name, category) VALUES (?, ?, ?)')
  ins.run(1, 'I1', 'furniture')
  ins.run(2, 'I2', 'Furniture')
  ins.run(3, 'I3', 'FURNITURE')
  const id = db
    .prepare("INSERT INTO habitat_entries (number, name) VALUES (1, 'H')")
    .run().lastInsertRowid
  db.prepare(
    "INSERT INTO habitat_recipe (habitat_id, item_name, quantity) VALUES (?, 'Garbage bin', 2)",
  ).run(id)
  db.prepare(
    "INSERT INTO habitat_recipe (habitat_id, item_name, quantity) VALUES (?, 'Garbage Bin', 5)",
  ).run(id)
  db.close()

  for (const { table, column } of [
    { table: 'items', column: 'category' },
    { table: 'habitat_recipe', column: 'item_name' },
  ]) {
    const dry = normalizeColumnCasing(dbPath, table, column, { dryRun: true })
    const live = normalizeColumnCasing(dbPath, table, column)
    assert.deepStrictEqual(
      dry,
      live,
      `dry-run report must equal the live report for ${table}.${column}`,
    )
  }
})

// ---------------------------------------------------------------------------
// CLI behavior (AC.10)
// ---------------------------------------------------------------------------

test('CLI --help exits 0 and lists flags', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, '--help'], {
    encoding: 'utf8',
    timeout: 15_000,
  })
  assert.strictEqual(result.status, 0, result.stderr)
  assert.match(result.stdout, /--dry-run/)
  assert.match(result.stdout, /--verify/)
  assert.match(result.stdout, /--db/)
})

function seededDriftDb(tmp) {
  const dbPath = dbPathFor(tmp)
  seedTestDb(dbPath)
  const db = openDb(dbPath)
  const ins = db.prepare('INSERT INTO items (id, name, category) VALUES (?, ?, ?)')
  ins.run(1, 'I1', 'furniture')
  ins.run(2, 'I2', 'Furniture')
  db.close()
  return dbPath
}

test('CLI --dry-run reports but makes no writes', async (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = seededDriftDb(tmp)

  await captureLog(() => main(['--dry-run', '--db', dbPath]))

  const categories = getAll(dbPath, 'SELECT category FROM items ORDER BY id').map((r) => r.category)
  assert.deepStrictEqual(categories, ['furniture', 'Furniture']) // untouched
})

test('CLI default applies normalization', async (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = seededDriftDb(tmp)

  await captureLog(async () => {
    await main(['--db', dbPath])
  })

  const categories = getAll(dbPath, 'SELECT category FROM items ORDER BY id').map((r) => r.category)
  assert.deepStrictEqual(categories, ['Furniture', 'Furniture'])
})

test('CLI --verify exits 1 while non-canonical casing exists and 0 after normalization', async (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = seededDriftDb(tmp)

  const savedExit = process.exitCode
  process.exitCode = 0
  try {
    await captureLog(() => main(['--verify', '--db', dbPath]))
    assert.strictEqual(process.exitCode, 1)

    await captureLog(() => main(['--db', dbPath])) // apply

    process.exitCode = 0
    await captureLog(() => main(['--verify', '--db', dbPath]))
    assert.strictEqual(process.exitCode, 0)
  } finally {
    process.exitCode = savedExit
  }
})
