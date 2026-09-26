// Normalize capitalization drift across the allowlisted vocabulary columns in
// src/pokehousing.sqlite. Stdlib only (node:sqlite, node:util).
//
// For every distinct casing of the same lowercase value, the most frequent
// variant wins; ties prefer the title-cased variant, then the
// lexicographically smallest. Rows whose primary key collides with an existing
// canonical-valued row are merged (deleted) rather than erroring. Name columns
// are hard-excluded by the allowlist in harvest_lib.js — the legacy-hash
// compatibility contract pins them byte-for-byte.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import {
  CASING_NORMALIZATION_TARGETS,
  DEFAULT_DB_PATH,
  normalizeColumnCasing,
} from './harvest_lib.js'

// ---------------------------------------------------------------------------
// CLI / main
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/normalize_capitalization.js [options]

Normalize capitalization drift in the allowlisted vocabulary columns
(items.category, habitat_entries.category, habitat_recipe.item_name,
habitat_pokemon.rarity, and the habitat_pokemon_location/time/weather value
columns) by majority rule: the most frequent casing wins; ties prefer the
title-cased variant, then the lexicographically smallest. Name columns are
never touched (legacy-hash compatibility guarantee).

Options:
  --dry-run    Report what would change, but do not write.
  --verify     Report only; exit 1 if any column still has non-canonical casing.
  --db <path>  Path to the SQLite DB (default: ${DEFAULT_DB_PATH})
  -h, --help   Show this help message and exit.
`

function reportTarget(dbPath, target, dryRun) {
  const changes = normalizeColumnCasing(dbPath, target.table, target.column, { dryRun })
  for (const change of changes) {
    const merged = change.mergedDeleted > 0 ? `, ${change.mergedDeleted} merged (deleted)` : ''
    console.log(
      `  ${change.table}.${change.column}: '${change.from}' -> '${change.to}' ` +
        `(${change.updated} updated${merged})`,
    )
  }
  return changes
}

export async function main(argv = process.argv.slice(2)) {
  let values
  try {
    values = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        'dry-run': { type: 'boolean', default: false },
        verify: { type: 'boolean', default: false },
        db: { type: 'string', default: DEFAULT_DB_PATH },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }).values
  } catch (e) {
    if (e instanceof TypeError) {
      console.error(e.message)
      console.log(USAGE)
      process.exit(2)
    }
    throw e
  }

  if (values.help) {
    console.log(USAGE)
    process.exit(0)
  }

  const dbPath = path.resolve(values.db)
  const dryRun = values['dry-run'] || values.verify

  console.log(
    `Normalizing capitalization in ${CASING_NORMALIZATION_TARGETS.length} columns` +
      `${dryRun ? ' (report-only)' : ''}.\n`,
  )

  let total = 0
  for (const target of CASING_NORMALIZATION_TARGETS) {
    const changes = reportTarget(dbPath, target, dryRun)
    total += changes.reduce((sum, c) => sum + c.updated + c.mergedDeleted, 0)
  }

  if (total === 0) {
    console.log('\nAll columns already use a single casing. Nothing to do.')
  } else if (dryRun) {
    console.log(`\n${total} change(s) ${values.verify ? 'still pending' : 'planned'}.`)
  } else {
    console.log(`\nApplied ${total} change(s).`)
  }

  // --verify doubles as a CI gate: pending normalization means non-canonical
  // casing exists, which must fail the run.
  if (values.verify && total > 0) {
    console.log('\n[VERIFY] FAIL: non-canonical casing remains.')
    process.exitCode = 1
  } else if (values.verify) {
    console.log('\n[VERIFY] PASS: every column uses its canonical casing.')
  }
}

// Run when this file is the entry point.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  await main()
}
