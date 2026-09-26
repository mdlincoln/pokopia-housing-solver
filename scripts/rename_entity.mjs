// Entity rename CLI with tombstone recording.
//
// Renames an entity (pokemon / item / habitat) in src/pokehousing.sqlite,
// cascades dependent text columns, and records a tombstone row so legacy URL
// hashes and saved islands (which encode entity *names*) can transparently
// upgrade to the canonical name at restore time.
//
// Stdlib only (node:sqlite, node:util), mirroring the harvest scripts'
// DB-open / arg-parsing conventions. The harvest scripts never rename; name
// changes must go through this CLI. After any rename, re-run
// `npm run build:data` so `public/data/tombstones.json` is rebaked.
//
// Usage:
//   npm run rename:entity -- --ensure-schema
//   npm run rename:entity -- --type pokemon|item|habitat --from "Old" --to "New" [--dry-run]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { DatabaseSync } from 'node:sqlite'

import { DEFAULT_DB_PATH, openWritableDb } from './harvest_lib.js'

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url))
const DB_SQL_PATH = path.join(SCRIPTS_DIR, 'db.sql')

// Per-type wiring: live entity table, tombstone table, and the tombstone FK
// column pointing at the live entity's integer id.
const ENTITY_TYPES = {
  pokemon: { table: 'pokemon', tombstones: 'pokemon_tombstones', fkColumn: 'pokemon_id' },
  item: { table: 'items', tombstones: 'item_tombstones', fkColumn: 'item_id' },
  habitat: {
    table: 'habitat_entries',
    tombstones: 'habitat_tombstones',
    fkColumn: 'habitat_id',
  },
}

const TOMBSTONE_TABLES = ['pokemon_tombstones', 'item_tombstones', 'habitat_tombstones']

/**
 * Parse the tombstone CREATE TABLE statements from scripts/db.sql and return
 * them rewritten as CREATE TABLE IF NOT EXISTS.
 */
export function tombstoneDdlStatements(schemaSql = fs.readFileSync(DB_SQL_PATH, 'utf8')) {
  const statements = []
  for (const tableName of TOMBSTONE_TABLES) {
    const re = new RegExp(`CREATE\\s+TABLE\\s+${tableName}\\s+\\([\\s\\S]*?\\);`, 'i')
    const match = re.exec(schemaSql)
    if (!match) {
      throw new Error(`Could not find CREATE TABLE for ${tableName} in db.sql`)
    }
    statements.push(match[0].replace(/CREATE\s+TABLE/i, 'CREATE TABLE IF NOT EXISTS'))
  }
  return statements
}

function ensureSchemaOn(db, statements) {
  for (const stmt of statements) {
    db.exec(stmt)
  }
}

/**
 * Apply the tombstone schema to a DB file. Idempotent; this is the migration
 * entry point (`npm run rename:entity -- --ensure-schema`).
 */
export function ensureSchema(dbPath) {
  const db = openWritableDb(dbPath)
  try {
    ensureSchemaOn(db, tombstoneDdlStatements())
  } finally {
    db.close()
  }
}

function tableExists(db, name) {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  )
}

/**
 * Validation and pre-flight checks, run inside the write transaction before
 * any writes. Throws with a clear message on any violation.
 */
function validateInputs(db, type, fromName, toName) {
  const entity = ENTITY_TYPES[type]

  if (typeof toName !== 'string' || toName.trim() === '') {
    throw new Error(`--to must be a non-empty name`)
  }

  // --from must exist in the live table (byte-exact; names are pinned
  // byte-for-byte by the legacy-hash contract).
  const live = db.prepare(`SELECT id FROM ${entity.table} WHERE name = ?`).get(fromName)
  if (live === undefined) {
    const ci = db
      .prepare(`SELECT name FROM ${entity.table} WHERE lower(name) = lower(?)`)
      .get(fromName)
    const hint = ci ? ` (found a case-insensitive match: '${ci.name}')` : ''
    throw new Error(`--from '${fromName}' does not exist in ${entity.table}${hint}`)
  }

  // --to must not exist in the live table, exactly or case-insensitively. The
  // case-insensitive check includes case-variants of --from itself: a case-only
  // rename is forbidden by the same convention that pins name capitalization.
  const toExact = db.prepare(`SELECT 1 FROM ${entity.table} WHERE name = ?`).get(toName)
  if (toExact !== undefined) {
    throw new Error(`--to '${toName}' already exists in ${entity.table}`)
  }
  const toCi = db
    .prepare(`SELECT name FROM ${entity.table} WHERE lower(name) = lower(?)`)
    .get(toName)
  if (toCi !== undefined) {
    throw new Error(
      `--to '${toName}' collides case-insensitively with existing ${entity.table} name ` +
        `'${toCi.name}'`,
    )
  }

  const warnings = []

  const tombstoneChecksApply = tableExists(db, entity.tombstones)
  if (tombstoneChecksApply) {
    // --from must not already be a tombstone old_name (that entity was renamed
    // away before; rename the live entity that now holds the name instead).
    const fromTombstoned = db
      .prepare(`SELECT 1 FROM ${entity.tombstones} WHERE old_name = ?`)
      .get(fromName)
    if (fromTombstoned !== undefined) {
      throw new Error(
        `--from '${fromName}' already has a tombstone row in ${entity.tombstones}; the live ` +
          `entity holding that name was renamed there previously. Rename the live entity ` +
          `that now holds this name instead.`,
      )
    }
    // --to being a tombstone old_name is allowed (the name was renamed away
    // earlier), but old hashes referencing --to then resolve via the live
    // catalog first, i.e. to the new occupant.
    const toTombstoned = db
      .prepare(`SELECT 1 FROM ${entity.tombstones} WHERE old_name = ?`)
      .get(toName)
    if (toTombstoned !== undefined) {
      warnings.push(
        `'${toName}' already exists as a tombstone old_name in ${entity.tombstones}: old ` +
          `hashes referencing '${toName}' resolve via the live catalog first and will now ` +
          `resolve to the new occupant.`,
      )
    }
  }

  // Pokemon-only spawn-roster collision: habitat_pokemon.pokemon_name is free
  // text with no FK to pokemon, so spawn-only roster names (e.g. Porygon-Z)
  // can occupy a name that looks free in the pokemon table. A collision would
  // hit the habitat_pokemon (habitat_id, pokemon_name) primary key partway
  // through the transaction — reject before any writes.
  if (type === 'pokemon') {
    const collidingHabitats = db
      .prepare(
        `SELECT DISTINCT hp.habitat_id FROM habitat_pokemon hp ` +
          `WHERE hp.pokemon_name = ? AND EXISTS (` +
          `SELECT 1 FROM habitat_pokemon hp2 ` +
          `WHERE hp2.pokemon_name = ? AND hp2.habitat_id = hp.habitat_id)`,
      )
      .all(fromName, toName)
    if (collidingHabitats.length > 0) {
      throw new Error(
        `--to '${toName}' already appears as a habitat_pokemon spawn name in ` +
          `${collidingHabitats.length} habitat(s) where '${fromName}' also spawns. Renaming ` +
          `would violate the habitat_pokemon (habitat_id, pokemon_name) primary key.`,
      )
    }
  }

  // Item-only recipe-text collision (same failure class): habitat_recipe
  // (habitat_id, item_name) is a composite primary key over free text.
  if (type === 'item') {
    const colliding = db
      .prepare(
        `SELECT 1 FROM habitat_recipe hr ` +
          `WHERE hr.item_name = ? AND EXISTS (` +
          `SELECT 1 FROM habitat_recipe hr2 ` +
          `WHERE hr2.item_name = ? AND hr2.habitat_id = hr.habitat_id)`,
      )
      .get(fromName, toName)
    if (colliding !== undefined) {
      throw new Error(
        `--to '${toName}' already appears in habitat_recipe for a habitat whose recipe also ` +
          `contains '${fromName}'. Renaming would violate the habitat_recipe ` +
          `(habitat_id, item_name) primary key.`,
      )
    }
  }

  return { entityId: live.id, warnings }
}

/**
 * Plan the text-column cascade UPDATEs for a rename. Each entry is
 * { table, count } where count is affected-row estimate. Rows are ordered
 * children-first so the composite FKs to habitat_pokemon stay satisfiable
 * even without deferred constraints.
 */
function cascadePlan(db, type, fromName) {
  if (type === 'pokemon') {
    const joinTables = [
      'habitat_pokemon_location',
      'habitat_pokemon_time',
      'habitat_pokemon_weather',
    ]
    return [
      ...joinTables.map((table) => ({
        table,
        count: db
          .prepare(`SELECT COUNT(*) AS cnt FROM ${table} WHERE pokemon_name = ?`)
          .get(fromName).cnt,
      })),
      {
        table: 'habitat_pokemon',
        count: db
          .prepare(`SELECT COUNT(*) AS cnt FROM habitat_pokemon WHERE pokemon_name = ?`)
          .get(fromName).cnt,
      },
      { table: 'pokemon', count: 1 },
    ]
  }
  if (type === 'item') {
    return [
      {
        table: 'habitat_recipe',
        count: db
          .prepare(`SELECT COUNT(*) AS cnt FROM habitat_recipe WHERE item_name = ?`)
          .get(fromName).cnt,
      },
      { table: 'items', count: 1 },
    ]
  }
  // habitat: every other habitat table references habitat_entries (id), so
  // only the entity row itself changes.
  return [{ table: 'habitat_entries', count: 1 }]
}

/**
 * Rename an entity transactionally and record its tombstone.
 *
 * Returns a report { type, from, to, dryRun, updates: [{table, updated}],
 * tombstoneRow: boolean, warnings: string[] }. Nothing is written when
 * dryRun is true (no DDL, no INSERT, no UPDATE).
 */
export function renameEntity(dbPath, type, fromName, toName, { dryRun = false } = {}) {
  if (!Object.hasOwn(ENTITY_TYPES, type)) {
    throw new Error(
      `Unknown --type '${type}'. Expected one of: ${Object.keys(ENTITY_TYPES).join(', ')}`,
    )
  }
  const entity = ENTITY_TYPES[type]
  const warnings = []
  let updated

  const db = openWritableDb(dbPath)
  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      if (!dryRun) {
        // Tombstone DDL on the same connection (a second connection would hit
        // the write lock) and FK checks that fire at COMMIT, so the
        // habitat_pokemon* child-to-parent composite FKs can't trip
        // mid-rename regardless of statement order.
        ensureSchemaOn(db, tombstoneDdlStatements())
        db.exec('PRAGMA defer_foreign_keys = ON')
      }

      const { entityId, warnings: validationWarnings } = validateInputs(db, type, fromName, toName)
      warnings.push(...validationWarnings)

      if (dryRun) {
        // Same report shape as a real run: counts are the affected rows.
        updated = cascadePlan(db, type, fromName).map(({ table, count }) => ({
          table,
          updated: count,
        }))
        warnings.push('(dry-run: nothing written)')
      } else {
        // Tombstone first: old live name -> the entity's current id. The FK
        // keeps pointing at the surviving row after the rename.
        db.prepare(
          `INSERT INTO ${entity.tombstones} (old_name, ${entity.fkColumn}) VALUES (?, ?)`,
        ).run(fromName, entityId)

        updated = []
        for (const { table } of cascadePlan(db, type, fromName)) {
          // Column being renamed: the entity table's `name`, or the join
          // tables' text name column (`pokemon_name` / `item_name` — the
          // latter is intentionally not an FK, per AGENTS.md).
          const col =
            type === 'pokemon'
              ? table === 'pokemon'
                ? 'name'
                : 'pokemon_name'
              : type === 'item'
                ? table === 'items'
                  ? 'name'
                  : 'item_name'
                : 'name'
          const result = db
            .prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`)
            .run(toName, fromName)
          updated.push({ table, updated: Number(result.changes) })
        }
      }

      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  } finally {
    db.close()
  }

  return { type, from: fromName, to: toName, dryRun, updates: updated, warnings }
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    options: {
      type: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'ensure-schema': { type: 'boolean', default: false },
    },
    args: argv,
  })

  if (values['ensure-schema']) {
    ensureSchema(DEFAULT_DB_PATH)
    console.log('Tombstone schema ensured in ' + DEFAULT_DB_PATH)
    console.log('(pokemon_tombstones, item_tombstones, habitat_tombstones)')
    return
  }

  if (!values.type || !values.from || !values.to) {
    console.error(
      'Usage: npm run rename:entity -- --type pokemon|item|habitat --from "Old Name" --to "New Name" [--dry-run]\n' +
        '       npm run rename:entity -- --ensure-schema',
    )
    process.exitCode = 1
    return
  }

  const type = values.type
  if (!Object.hasOwn(ENTITY_TYPES, type)) {
    console.error(
      `Unknown --type '${type}'. Expected one of: ${Object.keys(ENTITY_TYPES).join(', ')}`,
    )
    process.exitCode = 1
    return
  }

  const report = renameEntity(DEFAULT_DB_PATH, type, values.from, values.to, {
    dryRun: values['dry-run'],
  })

  for (const w of report.warnings) {
    console.log(`WARNING: ${w}`)
  }
  console.log(`${type}: ${report.from} -> ${report.to}`)
  for (const { table, updated } of report.updates) {
    console.log(`  ${table}: ${updated} row(s)`)
  }
  if (!report.dryRun) {
    console.log(
      `Tombstone recorded in ${
        ENTITY_TYPES[type].tombstones
      }: ${report.from} -> #${ENTITY_TYPES[type].fkColumn}`,
    )
    console.log('Re-run npm run build:data to bake public/data/tombstones.json.')
  }
}

// Run when this file is the entry point.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  if (usingNodeSqliteOk()) {
    await main()
  }
}

function usingNodeSqliteOk() {
  try {
    void new DatabaseSync(':memory:').close()
    return true
  } catch (e) {
    console.error(e.message)
    return false
  }
}
