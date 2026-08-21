// Tests for e2e/fixtures/legacy-saved-query.json — the legacy localStorage
// saved-query fixture (key `pokehousing_saved_queries`).
//
// Guards the sql.js → baked-data migration's only real compatibility risk for
// the *saved-query* (localStorage) path: *name drift*. A saved-query value
// serialized by an old commit (c016616 — runtime sql.js queries against
// public/pokehousing.sqlite) is JSON.stringify(SavedQuery[]) — a plain JSON
// array of v2 SharedState entries plus { title, timestamp }. The serialization
// contract is unchanged in HEAD, so the only way a legacy entry silently breaks
// is if a pokemon/item name it references no longer resolves in the new baked
// payloads (src/data/pokemon.json, src/data/items.json). These tests pin that
// resolution plus the byte-for-byte storage round-trip as a fast, deterministic
// regression guard that runs with no browser.

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { PROJECT_ROOT } from './harvest_lib.js'

const FIXTURE_PATH = path.join(PROJECT_ROOT, 'e2e', 'fixtures', 'legacy-saved-query.json')
const POKEMON_JSON = path.join(PROJECT_ROOT, 'src', 'data', 'pokemon.json')
const ITEMS_JSON = path.join(PROJECT_ROOT, 'src', 'data', 'items.json')

const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))
const pokemon = JSON.parse(fs.readFileSync(POKEMON_JSON, 'utf8'))
const items = JSON.parse(fs.readFileSync(ITEMS_JSON, 'utf8'))

// ---------------------------------------------------------------------------
// AC.1 — Fixture well-formedness and provenance.
// ---------------------------------------------------------------------------

test('fixture is well-formed and its stored string parses to its decoded array', () => {
  assert.strictEqual(typeof fixture.sourceCommit, 'string')
  assert.match(fixture.sourceCommit, /^[0-9a-f]{40}$/)
  assert.strictEqual(fixture.sourceCommit, 'c01661681cb01dc28f47772b8a7791f7ea7a4dc2')
  assert.strictEqual(typeof fixture.capturedAt, 'string')
  assert.strictEqual(typeof fixture.stored, 'string')
  assert.ok(fixture.stored.length > 0)

  // loadSavedQueries() does JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'),
  // so `stored` must parse to a plain array.
  const decoded = JSON.parse(fixture.stored)
  assert.deepStrictEqual(decoded, fixture.decoded)

  assert.ok(Array.isArray(decoded), 'decoded must be an array')
  assert.ok(decoded.length >= 1, 'decoded must contain at least one entry')
  const entry = decoded[0]

  assert.strictEqual(entry.version, 2)
  assert.strictEqual(entry.small, 1)
  assert.strictEqual(entry.medium, 3)
  assert.strictEqual(entry.large, 2)
  assert.strictEqual(typeof entry.title, 'string')
  assert.strictEqual(typeof entry.timestamp, 'number')
  assert.ok(Array.isArray(entry.pokemon), 'entry.pokemon must be an array')
  assert.strictEqual(entry.pokemon.length, 13)
  assert.ok(Array.isArray(entry.cart), 'entry.cart must be an array')
  assert.ok(entry.cart.length >= 3, 'fixture must have at least 3 distinct cart entries')
})

// ---------------------------------------------------------------------------
// AC.3 — decode → re-encode round-trip is byte-identical against the v2 schema.
// ---------------------------------------------------------------------------

test('fixture stored string is stable under decode → re-encode across the v2 schema', () => {
  const decoded = JSON.parse(fixture.stored)
  assert.strictEqual(JSON.stringify(decoded), fixture.stored)
})

// ---------------------------------------------------------------------------
// AC.2 — Every name referenced by the captured storage still resolves in HEAD.
// ---------------------------------------------------------------------------

test('every pokemon name referenced by the storage resolves in the baked catalog', () => {
  assert.ok(pokemon.dataByName, 'pokemon.json must expose dataByName')
  for (const name of fixture.decoded[0].pokemon) {
    const detail = pokemon.dataByName[name]
    assert.ok(detail, `pokemon "${name}" is missing from src/data/pokemon.json`)
    assert.strictEqual(typeof detail.image, 'string', `pokemon "${name}" image must be a string`)
    assert.ok(detail.image.length > 0, `pokemon "${name}" image must be non-empty`)
  }
})

test('every item name referenced by the storage resolves in the baked catalog', () => {
  assert.ok(items.itemDetailsByName, 'items.json must expose itemDetailsByName')
  const names = new Set(fixture.decoded[0].cart.map((entry) => entry.name))
  for (const name of names) {
    const detail = items.itemDetailsByName[name]
    assert.ok(detail, `item "${name}" is missing from src/data/items.json`)
    assert.notStrictEqual(detail.picturePath, null, `item "${name}" picturePath must be non-null`)
    assert.ok(
      typeof detail.picturePath === 'string' && detail.picturePath.length > 0,
      `item "${name}" picturePath must be a non-empty string`,
    )
  }
})

test('composite-key names resolve when pinnedPokemon / checkedCartItems / placedItems are present', () => {
  const entry = fixture.decoded[0]
  const compositeFields = [entry.pinnedPokemon, entry.checkedCartItems, entry.placedItems].filter(
    (field) => Array.isArray(field),
  )

  // A plain loadSample() island clears pins/progress, so these fields are
  // legitimately empty. When present, split each "houseId:name" key and assert
  // the name half resolves per the pokemon/item rules.
  for (const field of compositeFields) {
    for (const key of field) {
      const colonIdx = key.indexOf(':')
      assert.ok(colonIdx > 0, `composite key "${key}" must contain a ':' separator`)
      const name = key.slice(colonIdx + 1)
      const resolved =
        pokemon.dataByName[name] !== undefined || items.itemDetailsByName[name] !== undefined
      assert.ok(resolved, `composite-key name "${name}" does not resolve in the baked data`)
    }
  }
})
