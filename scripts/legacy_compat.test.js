// Tests for e2e/fixtures/legacy-island.json — the legacy URL-hash fixture.
//
// Guards the sql.js → baked-data migration's only real compatibility risk:
// *name drift*. A URL hash produced by an old commit (c016616 — runtime sql.js
// queries against public/pokehousing.sqlite) is btoa(JSON.stringify(SharedState)),
// and the serialization contract (SharedState v2) is unchanged in HEAD. The
// only way a legacy hash silently breaks is if a pokemon/item name it references
// no longer resolves in the new baked payloads (src/data/pokemon.json,
// src/data/items.json). These tests pin that resolution as a fast, deterministic
// regression guard that runs with no browser.

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { PROJECT_ROOT } from './harvest_lib.js'

const FIXTURE_PATH = path.join(PROJECT_ROOT, 'e2e', 'fixtures', 'legacy-island.json')
const POKEMON_JSON = path.join(PROJECT_ROOT, 'src', 'data', 'pokemon.json')
const ITEMS_JSON = path.join(PROJECT_ROOT, 'src', 'data', 'items.json')

const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))
const pokemon = JSON.parse(fs.readFileSync(POKEMON_JSON, 'utf8'))
const items = JSON.parse(fs.readFileSync(ITEMS_JSON, 'utf8'))

// ---------------------------------------------------------------------------
// AC.1 — Fixture well-formedness and provenance.
// ---------------------------------------------------------------------------

test('fixture is well-formed and its atob hash round-trips to its decoded state', () => {
  assert.strictEqual(typeof fixture.sourceCommit, 'string')
  assert.match(fixture.sourceCommit, /^[0-9a-f]{40}$/)
  assert.strictEqual(fixture.sourceCommit, 'c01661681cb01dc28f47772b8a7791f7ea7a4dc2')
  assert.strictEqual(typeof fixture.capturedAt, 'string')
  assert.strictEqual(typeof fixture.hash, 'string')
  assert.ok(fixture.hash.length > 0)

  // decodeStateFromUrl slices the leading '#' from location.hash, then atob()s.
  const decoded = JSON.parse(atob(fixture.hash))
  assert.deepStrictEqual(decoded, fixture.decoded)

  assert.strictEqual(decoded.version, 2)
  assert.strictEqual(decoded.small, 1)
  assert.strictEqual(decoded.medium, 3)
  assert.strictEqual(decoded.large, 2)
  assert.ok(Array.isArray(decoded.pokemon), 'decoded.pokemon must be an array')
  assert.strictEqual(decoded.pokemon.length, 13)
  assert.ok(Array.isArray(decoded.cart), 'decoded.cart must be an array')
  assert.ok(decoded.cart.length >= 3, 'fixture must have at least 3 distinct cart entries')
})

// ---------------------------------------------------------------------------
// AC.4 — decode → re-encode round-trip is byte-identical against the v2 schema.
// ---------------------------------------------------------------------------

test('fixture hash is stable under decode → re-encode across the v2 schema', () => {
  const decoded = JSON.parse(atob(fixture.hash))
  assert.strictEqual(btoa(JSON.stringify(decoded)), fixture.hash)
})

// ---------------------------------------------------------------------------
// AC.2 — Every name referenced by the captured hash still resolves in HEAD.
// ---------------------------------------------------------------------------

test('every pokemon name referenced by the hash resolves in the baked catalog', () => {
  assert.ok(pokemon.dataByName, 'pokemon.json must expose dataByName')
  for (const name of fixture.decoded.pokemon) {
    const detail = pokemon.dataByName[name]
    assert.ok(detail, `pokemon "${name}" is missing from src/data/pokemon.json`)
    assert.strictEqual(typeof detail.image, 'string', `pokemon "${name}" image must be a string`)
    assert.ok(detail.image.length > 0, `pokemon "${name}" image must be non-empty`)
  }
})

test('every item name referenced by the hash resolves in the baked catalog', () => {
  assert.ok(items.itemDetailsByName, 'items.json must expose itemDetailsByName')
  const names = new Set(fixture.decoded.cart.map((entry) => entry.name))
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
  const compositeFields = [
    fixture.decoded.pinnedPokemon,
    fixture.decoded.checkedCartItems,
    fixture.decoded.placedItems,
  ].filter((field) => Array.isArray(field))

  // A plain loadSample() island clears pins/progress, so these fields are
  // legitimately absent. When present, split each "houseId:name" key and assert
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
