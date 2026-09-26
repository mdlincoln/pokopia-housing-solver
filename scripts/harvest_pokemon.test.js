// Unit tests for scripts/harvest_pokemon.js.
//
// Stdlib only (node:test + node:assert). Parsers are pure, so this suite feeds
// canned HTML directly (no fetch mock). Parser coverage is net-new: the former
// Python port shipped without unit tests for its regexes.

import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import {
  parsePokemonDetailHtml,
  parsePokemonListHtml,
  main,
  updateExistingPokemon,
} from './harvest_pokemon.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = path.join(HERE, 'harvest_pokemon.js')
const DB_SQL_PATH = path.join(HERE, 'db.sql')

// ---------------------------------------------------------------------------
// Canned HTML snippets
// ---------------------------------------------------------------------------

// One valid pokedex link, one specialty* nav link, one idealhabitat* nav link,
// and one duplicate of the valid link (across list pages).
const POKEMON_LIST_HTML = `
<a href="/pokemonpokopia/pokedex/001-bulbasaur.shtml"><u>Bulbasaur</u></a>
<a href="/pokemonpokopia/pokedex/specialty1.shtml"><u>Specialty</u></a>
<a href="/pokemonpokopia/pokedex/idealhabitatbright.shtml"><u>Ideal Habitat</u></a>
<a href="/pokemonpokopia/pokedex/001-bulbasaur.shtml"><u>Bulbasaur</u></a>
`

// Full pokemon detail page: sprite-regular img, idealhabitat link, favorites.
const POKEMON_DETAIL_HTML = `
<img src="/pokemonpokopia/sugimori/001.png" id="sprite-regular" alt="Bulbasaur">
<a href="/pokemonpokopia/idealhabitat/bright.shtml"><u>Bright</u></a>
<a href="/pokemonpokopia/favorites/blockystuff.shtml"><u>Blocky stuff</u></a>
<a href="/pokemonpokopia/favorites/cleanliness.shtml"><u>Cleanliness</u></a>
`

// ----------
// AC.1 — CLI --help
// ----------

test('CLI --help exits 0 and lists flags', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, '--help'], {
    encoding: 'utf8',
    timeout: 15_000,
  })
  assert.strictEqual(result.status, 0, result.stderr)
  assert.match(result.stdout, /--dry-run/)
  assert.match(result.stdout, /--verify/)
  assert.match(result.stdout, /--delay/)
  assert.match(result.stdout, /--db/)
  assert.match(result.stdout, /--images-dir/)
})

// ---------------------------------------------------------------------------
// AC.11 — list parser filters skip-prefixes and dedupes
// ---------------------------------------------------------------------------

test('parsePokemonListHtml filters specialty/idealhabitat links and dedupes', () => {
  const entries = parsePokemonListHtml(POKEMON_LIST_HTML)
  assert.strictEqual(entries.length, 1)
  assert.deepStrictEqual(entries[0], { slug: '001-bulbasaur', name: 'Bulbasaur' })
})

// ---------------------------------------------------------------------------
// AC.11 — detail parser extracts sprite, habitat, favorites
// ---------------------------------------------------------------------------

test('parsePokemonDetailHtml extracts image, habitat, and favorites', () => {
  const detail = parsePokemonDetailHtml(POKEMON_DETAIL_HTML, '001-bulbasaur')
  assert.ok(detail)
  assert.strictEqual(detail.imageUrl, '/pokemonpokopia/sugimori/001.png')
  assert.strictEqual(detail.imageFilename, '001.png')
  assert.strictEqual(detail.habitat, 'Bright')
  assert.deepStrictEqual(detail.favorites, ['Blocky stuff', 'Cleanliness'])
})

test('parsePokemonDetailHtml returns null on missing image', () => {
  const html = `
<a href="/pokemonpokopia/idealhabitat/bright.shtml"><u>Bright</u></a>
<a href="/pokemonpokopia/favorites/blockystuff.shtml"><u>Blocky stuff</u></a>
`
  const detail = parsePokemonDetailHtml(html, '001-bulbasaur')
  assert.strictEqual(detail, null)
})

test('parsePokemonDetailHtml returns null on missing habitat', () => {
  const html = `
<img src="/pokemonpokopia/sugimori/001.png" id="sprite-regular" alt="Bulbasaur">
<a href="/pokemonpokopia/favorites/blockystuff.shtml"><u>Blocky stuff</u></a>
`
  const detail = parsePokemonDetailHtml(html, '001-bulbasaur')
  assert.strictEqual(detail, null)
})

// ---------------------------------------------------------------------------
// --update-existing (Phase 4 of the plan: full sync)
// ---------------------------------------------------------------------------

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harvest-pokemon-'))
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

function stubFetch(t, htmlByUrlMatch) {
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    const html = htmlByUrlMatch(url)
    const bytes = new TextEncoder().encode(html)
    return {
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    }
  }
  t.after(() => {
    globalThis.fetch = original
  })
}

function readDb(dbPath, sql, params = []) {
  const ro = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return ro.prepare(sql).all(...params)
  } finally {
    ro.close()
  }
}

/**
 * Seed DB: habitats axes, 'blocky stuff' favorite, pokemon 1 'Bulbasaur'
 * (habitat 'Dark', sprite file) with favorite 'cleanliness' (to be removed).
 * Optionally pokemon 9 'Vanishedmon' absent from the scraped list.
 */
function seedPokemonFixtures(dbPath, imagesDir, { withVanished = false } = {}) {
  const db = openDb(dbPath)
  db.exec('BEGIN')
  db.prepare("INSERT INTO habitats (habitat, opposite) VALUES ('Bright', 'Dark')").run()
  db.prepare("INSERT INTO habitats (habitat, opposite) VALUES ('Dark', 'Bright')").run()
  db.exec('COMMIT')
  db.prepare("INSERT INTO favorites (name) VALUES ('blocky stuff')").run()
  db.prepare("INSERT INTO favorites (name) VALUES ('cleanliness')").run()
  db.prepare(
    "INSERT INTO pokemon (id, name, image_path, habitat) VALUES (1, 'Bulbasaur', 'images/001-bulbasaur.png', 'Dark')",
  ).run()
  db.prepare(
    "INSERT INTO pokemon_favorites (pokemon_id, favorite_name) VALUES (1, 'cleanliness')",
  ).run()
  if (withVanished) {
    db.prepare(
      "INSERT INTO pokemon (id, name, image_path) VALUES (9, 'Vanishedmon', 'images/vanishedmon.png')",
    ).run()
  }
  db.close()

  fs.mkdirSync(imagesDir, { recursive: true })
  const sprites = ['001-bulbasaur.png']
  if (withVanished) {
    sprites.push('vanishedmon.png')
  }
  for (const sprite of sprites) {
    fs.writeFileSync(path.join(imagesDir, sprite), 'png-bytes')
  }
}

const POKEMON_ENTRIES = [{ slug: '001-bulbasaur', name: 'Bulbasaur' }]

// Update-pass detail page: same layout but only 'Blocky stuff' is a favorite,
// so seeding 'cleanliness' creates a genuine full-sync deletion scenario.
const POKEMON_DETAIL_SYNC_HTML = `
<img src="/pokemonpokopia/sugimori/001.png" id="sprite-regular" alt="Bulbasaur">
<a href="/pokemonpokopia/idealhabitat/bright.shtml"><u>Bright</u></a>
<a href="/pokemonpokopia/favorites/blockystuff.shtml"><u>Blocky stuff</u></a>
`

test('updateExistingPokemon refreshes habitat and full-syncs favorites; name pinned', async (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  const imagesDir = path.join(tmp, 'images')
  seedTestDb(dbPath)
  seedPokemonFixtures(dbPath, imagesDir)

  stubFetch(t, (url) => {
    if (url.includes('/pokedex/')) {
      return POKEMON_DETAIL_SYNC_HTML
    }
    return POKEMON_LIST_HTML
  })

  const existingFavLower = new Set(['blocky stuff', 'cleanliness'])

  const summary = await updateExistingPokemon(
    dbPath,
    POKEMON_ENTRIES,
    imagesDir,
    0,
    existingFavLower,
  )

  // Habitat refreshed Dark -> Bright (case-insensitively validated axis value).
  const row = readDb(dbPath, 'SELECT * FROM pokemon WHERE id = 1')[0]
  assert.strictEqual(row.habitat, 'Bright')
  assert.strictEqual(row.name, 'Bulbasaur') // never renamed (legacy-hash contract)
  assert.strictEqual(row.image_path, 'images/001-bulbasaur.png')
  assert.strictEqual(summary.habitatUpdates, 1)

  // Favorites full sync: 'cleanliness' deleted, 'blocky stuff' inserted (AC.5).
  const favs = readDb(
    dbPath,
    'SELECT favorite_name FROM pokemon_favorites WHERE pokemon_id = 1',
  ).map((r) => r.favorite_name)
  assert.deepStrictEqual(favs.sort(), ['blocky stuff'])
  assert.strictEqual(summary.favDeleted, 1)
  assert.strictEqual(summary.favInserted, 1)
})

test('updateExistingPokemon leaves synced rows alone on a second pass', async (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  const imagesDir = path.join(tmp, 'images')
  seedTestDb(dbPath)
  seedPokemonFixtures(dbPath, imagesDir)

  stubFetch(t, (url) => (url.includes('/pokedex/') ? POKEMON_DETAIL_SYNC_HTML : POKEMON_LIST_HTML))

  const existingFavLower = new Set(['blocky stuff', 'cleanliness'])
  await updateExistingPokemon(dbPath, POKEMON_ENTRIES, imagesDir, 0, existingFavLower)
  const before = {
    pokemon: readDb(dbPath, 'SELECT * FROM pokemon ORDER BY id').map((r) => ({ ...r })),
    favs: readDb(dbPath, 'SELECT * FROM pokemon_favorites ORDER BY pokemon_id'),
  }
  const summary = await updateExistingPokemon(
    dbPath,
    POKEMON_ENTRIES,
    imagesDir,
    0,
    existingFavLower,
  )
  const after = {
    pokemon: readDb(dbPath, 'SELECT * FROM pokemon ORDER BY id').map((r) => ({ ...r })),
    favs: readDb(dbPath, 'SELECT * FROM pokemon_favorites ORDER BY pokemon_id'),
  }
  assert.deepStrictEqual(after, before)
  assert.strictEqual(summary.habitatUpdates, 0)
  assert.strictEqual(summary.favInserted + summary.favDeleted, 0)
})

test('top-level guard: a pokemon absent from the scraped list survives --update-existing', async (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  const imagesDir = path.join(tmp, 'images')
  seedTestDb(dbPath)
  seedPokemonFixtures(dbPath, imagesDir, { withVanished: true })

  stubFetch(t, (url) => (url.includes('/pokedex/') ? POKEMON_DETAIL_SYNC_HTML : POKEMON_LIST_HTML))

  const savedExit = process.exitCode
  process.exitCode = 0
  const originalLog = console.log
  console.log = () => {}
  try {
    await main(['--update-existing', '--db', dbPath, '--images-dir', imagesDir, '--delay', '0'])
  } finally {
    console.log = originalLog
    process.exitCode = savedExit
  }

  const vanished = readDb(dbPath, 'SELECT * FROM pokemon WHERE id = 9')
  assert.strictEqual(vanished.length, 1, 'the extra top-level row must survive the run')
  assert.strictEqual(vanished[0].name, 'Vanishedmon')
})

test('null-parse skip: a failed fetch/parse must not reconcile or delete sub-records (pokemon)', async (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  const imagesDir = path.join(tmp, 'images')
  seedTestDb(dbPath)
  seedPokemonFixtures(dbPath, imagesDir)

  stubFetch(t, () => '') // detail pages return '' -> parse -> null; list pages empty

  const existingFavLower = new Set(['blocky stuff', 'cleanliness'])
  const summary = await updateExistingPokemon(
    dbPath,
    [{ slug: 'missing', name: 'Bulbasaur' }],
    imagesDir,
    0,
    existingFavLower,
  )

  assert.strictEqual(summary.processed, 0)
  assert.strictEqual(summary.favDeleted, 0)
  assert.strictEqual(summary.favInserted, 0)
  assert.strictEqual(summary.habitatUpdates, 0)
  const favs = readDb(dbPath, 'SELECT COUNT(*) AS cnt FROM pokemon_favorites')[0]
  assert.strictEqual(favs.cnt, 1) // 'cleanliness' survived the failed scrape
})

test('--update-existing --dry-run prints the planned delta with zero DB writes (pokemon)', async (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  const imagesDir = path.join(tmp, 'images')
  seedTestDb(dbPath)
  seedPokemonFixtures(dbPath, imagesDir)

  stubFetch(t, (url) => (url.includes('/pokedex/') ? POKEMON_DETAIL_SYNC_HTML : POKEMON_LIST_HTML))

  const before = {
    pokemon: readDb(dbPath, 'SELECT * FROM pokemon ORDER BY id').map((r) => ({ ...r })),
    favs: readDb(dbPath, 'SELECT * FROM pokemon_favorites ORDER BY pokemon_id'),
  }

  const savedExit = process.exitCode
  process.exitCode = 0
  const originalLog = console.log
  const chunks = []
  console.log = (...args) => chunks.push(args.join(' '))
  try {
    await main([
      '--update-existing',
      '--dry-run',
      '--db',
      dbPath,
      '--images-dir',
      imagesDir,
      '--delay',
      '0',
    ])
  } finally {
    console.log = originalLog
    process.exitCode = savedExit
  }
  const output = chunks.join('\n')

  assert.match(output, /DRY RUN/)
  assert.match(output, /habitat: "Dark" -> "Bright"/)

  const after = {
    pokemon: readDb(dbPath, 'SELECT * FROM pokemon ORDER BY id').map((r) => ({ ...r })),
    favs: readDb(dbPath, 'SELECT * FROM pokemon_favorites ORDER BY pokemon_id'),
  }
  assert.deepStrictEqual(after, before)
})

// ---------------------------------------------------------------------------
// Verify exit-code gating (AC.8) — in-process main() since fetch cannot be
// stubbed across a spawnSync process boundary.
// ---------------------------------------------------------------------------

async function runPokemonVerify(t, { writeFile }) {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  const imagesDir = path.join(tmp, 'images')
  seedTestDb(dbPath)

  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys=ON')
  db.exec('BEGIN')
  db.prepare("INSERT INTO habitats (habitat, opposite) VALUES ('Bright', 'Dark')").run()
  db.prepare("INSERT INTO habitats (habitat, opposite) VALUES ('Dark', 'Bright')").run()
  db.exec('COMMIT')
  db.prepare(
    "INSERT INTO pokemon (id, name, image_path, habitat) VALUES (1, 'Bulbasaur', 'images/001-bulbasaur.png', 'Bright')",
  ).run()
  db.close()

  if (writeFile) {
    fs.mkdirSync(imagesDir, { recursive: true })
    fs.writeFileSync(path.join(imagesDir, '001-bulbasaur.png'), 'png')
  }

  stubFetch(t, (url) => (url.includes('/pokedex/') ? POKEMON_DETAIL_SYNC_HTML : POKEMON_LIST_HTML))

  const savedExit = process.exitCode
  process.exitCode = 0
  const originalLog = console.log
  console.log = () => {}
  let exit
  try {
    await main(['--verify', '--db', dbPath, '--images-dir', imagesDir, '--delay', '0'])
  } finally {
    console.log = originalLog
    exit = process.exitCode
    process.exitCode = savedExit
  }
  return exit
}

test('pokemon verify exit code: missing sprite file fails the gate (1)', async (t) => {
  const exit = await runPokemonVerify(t, { writeFile: false })
  assert.strictEqual(exit, 1)
})

test('pokemon verify exit code: clean DB verifies 0', async (t) => {
  const exit = await runPokemonVerify(t, { writeFile: true })
  assert.strictEqual(exit, 0)
})
