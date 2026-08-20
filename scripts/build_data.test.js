// Tests for scripts/build_data.mjs (the build-time data bake).
//
// Guards the regression surfaces of the sql.js → baked-data refactor:
//   * payload shapes (names sorted, matrix size N², sentinel encoding),
//   * deterministic output (run twice → identical bytes),
//   * ORDER BY parity with direct node:sqlite reads (itemsByFavorite /
//     recipeByItem insertion order is load-bearing for recommendations),
//   * round-trip correctness against the source DB for sampled rows/edges.

import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import { DEFAULT_DB_PATH, openReadOnlyDb, PROJECT_ROOT } from './harvest_lib.js'
import { buildAdjacency, buildItems, buildPokemon } from './build_data.mjs'

const POKEMON_JSON = path.join(PROJECT_ROOT, 'src', 'data', 'pokemon.json')
const ITEMS_JSON = path.join(PROJECT_ROOT, 'src', 'data', 'items.json')
const ADJACENCY_JSON = path.join(PROJECT_ROOT, 'public', 'data', 'adjacency.json')

function withDb(fn) {
  const db = openReadOnlyDb(DEFAULT_DB_PATH)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Shape tests
// ---------------------------------------------------------------------------

test('pokemon payload: names sorted, dataByName covers every name', () => {
  withDb((db) => {
    const { names, dataByName } = buildPokemon(db)
    assert.ok(names.length > 300)
    const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    assert.deepStrictEqual(names, sorted)
    assert.strictEqual(Object.keys(dataByName).length, names.length)
    for (const name of names) {
      const d = dataByName[name]
      assert.strictEqual(typeof d.image, 'string')
      assert.ok(Array.isArray(d.favorites))
    }
  })
})

test('items payload: graph keys present with expected cardinalities', () => {
  withDb((db) => {
    const graph = buildItems(db)
    assert.ok(Object.keys(graph.itemDetailsByName).length > 1600)
    assert.ok(Object.keys(graph.itemsByFavorite).length > 0)
    assert.ok(Object.keys(graph.recipeByItem).length > 800)
    for (const [name, detail] of Object.entries(graph.itemDetailsByName)) {
      assert.strictEqual(detail.name, name)
      assert.strictEqual(typeof detail.isCraftable, 'boolean')
    }
  })
})

test('adjacency payload: N² matrix, sentinel encoding, dense ids', () => {
  withDb((db) => {
    const { names, size, data, edgeCount } = buildAdjacency(db)
    assert.strictEqual(names.length, size)
    const bytes = Buffer.from(data, 'base64')
    assert.strictEqual(bytes.byteLength, size * size * 2)
    const matrix = new Int16Array(bytes.buffer, bytes.byteOffset, size * size)

    // Diagonal is always "no edge".
    for (let i = 0; i < size; i++) {
      assert.strictEqual(matrix[i * size + i], 0)
    }

    // Edge count matches the DB; every DB edge is encoded (nonzero off-diagonal).
    const dbEdgeCount = db.prepare(`SELECT COUNT(*) AS c FROM adjacency`).get().c
    assert.strictEqual(edgeCount, dbEdgeCount)
    let encodedEdges = 0
    for (let i = 0; i < matrix.length; i++) {
      if (matrix[i] !== 0) encodedEdges++
    }
    assert.strictEqual(encodedEdges, edgeCount)

    // Sentinel values only ever -1 / 0 / positive.
    for (const v of matrix) {
      assert.ok(v >= -1)
    }
  })
})

// ---------------------------------------------------------------------------
// Ordering parity with the source DB (load-bearing for AC.7)
// ---------------------------------------------------------------------------

test('itemsByFavorite ordering equals direct SQL with the same ORDER BY', () => {
  withDb((db) => {
    const graph = buildItems(db)
    const rows = db
      .prepare(
        `SELECT i.name AS item_name, IF.favorite_name
         FROM item_favorites IF
         JOIN items i ON i.id = IF.item_id
         ORDER BY i.id, IF.favorite_name`,
      )
      .all()
    const expected = {}
    for (const row of rows) {
      ;(expected[row.favorite_name] ??= []).push(row.item_name)
    }
    assert.deepStrictEqual(graph.itemsByFavorite, expected)
  })
})

test('recipeByItem ordering equals direct SQL with the same ORDER BY', () => {
  withDb((db) => {
    const graph = buildItems(db)
    const rows = db
      .prepare(
        `SELECT i.name AS item_name, ing.name AS ingredient_name, ing.picture_path, r.count
         FROM item_recipe r
         JOIN items i ON i.id = r.item_id
         JOIN items ing ON ing.id = r.ingredient_id
         ORDER BY i.id, ing.name`,
      )
      .all()
    const expected = {}
    for (const row of rows) {
      ;(expected[row.item_name] ??= []).push({
        ingredientName: row.ingredient_name,
        ingredientPicture: row.picture_path ?? null,
        count: row.count,
      })
    }
    assert.deepStrictEqual(graph.recipeByItem, expected)
  })
})

test('pokemon favorites ordering matches GROUP_CONCAT split for sampled pokemon', () => {
  withDb((db) => {
    const { dataByName } = buildPokemon(db)
    const sample = db.prepare(`SELECT id, name FROM pokemon ORDER BY id LIMIT 25`).all()
    for (const row of sample) {
      const direct = db
        .prepare(
          `SELECT GROUP_CONCAT(pf.favorite_name, '|') AS favorites_str
           FROM pokemon p
           LEFT JOIN pokemon_favorites pf ON p.id = pf.pokemon_id
           WHERE p.id = ?
           GROUP BY p.id`,
        )
        .get(row.id)
      const expectedFavorites = direct.favorites_str ? String(direct.favorites_str).split('|') : []
      assert.deepStrictEqual(dataByName[row.name].favorites, expectedFavorites, row.name)
    }
  })
})

// ---------------------------------------------------------------------------
// Adjacency round-trip: baked matrix cell == direct SQL edge, for a sample.
// ---------------------------------------------------------------------------

test('adjacency matrix round-trips against direct SQL for sampled edges', () => {
  withDb((db) => {
    const { names, size, data } = buildAdjacency(db)
    const matrix = new Int16Array(Buffer.from(data, 'base64').buffer.slice(0))

    const edges = db
      .prepare(`SELECT pokemon_a, pokemon_b, score FROM adjacency ORDER BY pokemon_a LIMIT 500`)
      .all()
    for (const edge of edges) {
      const cell = matrix[(edge.pokemon_a - 1) * size + (edge.pokemon_b - 1)]
      assert.strictEqual(cell, edge.score === null ? -1 : edge.score)
    }

    // A few known-name lookups through the names index.
    const indexByName = new Map(names.map((n, i) => [n, i]))
    const sample = db
      .prepare(
        `SELECT p1.name AS a, p2.name AS b, a.score
         FROM adjacency a
         JOIN pokemon p1 ON p1.id = a.pokemon_a
         JOIN pokemon p2 ON p2.id = a.pokemon_b
         WHERE a.score IS NOT NULL
         ORDER BY a.score DESC LIMIT 20`,
      )
      .all()
    for (const row of sample) {
      const cell = matrix[indexByName.get(row.a) * size + indexByName.get(row.b)]
      assert.strictEqual(cell, row.score)
    }
  })
})

// ---------------------------------------------------------------------------
// Determinism: bake twice against the same immutable DB snapshot → identical
// bytes. (Compares against a copy, not the committed outputs: sibling harvest
// tests may legitimately modify the DB mid-run, which would make a committed-
// output comparison racy. The sync check below runs on a fresh connection.)
// ---------------------------------------------------------------------------

test('npm run build:data is deterministic (identical bytes on re-run)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-data-'))
  const snapshotDb = path.join(tmp, 'pokehousing.sqlite')
  fs.copyFileSync(DEFAULT_DB_PATH, snapshotDb)
  try {
    const read1 = () => {
      const db = new DatabaseSync(snapshotDb, { readOnly: true })
      try {
        const pokemon = buildPokemon(db)
        const items = buildItems(db)
        const adjacency = buildAdjacency(db)
        return [
          JSON.stringify(pokemon),
          JSON.stringify(items),
          JSON.stringify({ names: adjacency.names, size: adjacency.size, data: adjacency.data }),
        ]
      } finally {
        db.close()
      }
    }
    assert.deepStrictEqual(read1(), read1())
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Committed-output sync: src/data/*.json and public/data/adjacency.json must
// match what the generator produces from the committed DB (clean checkouts
// build without running build:data first, so staleness is a silent-skew risk).
// ---------------------------------------------------------------------------

test('committed generated files are in sync with the generator output', () => {
  withDb((db) => {
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(POKEMON_JSON, 'utf8')),
      buildPokemon(db),
      'src/data/pokemon.json is stale — run npm run build:data',
    )
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(ITEMS_JSON, 'utf8')),
      buildItems(db),
      'src/data/items.json is stale — run npm run build:data',
    )
    const adj = buildAdjacency(db)
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(ADJACENCY_JSON, 'utf8')),
      { names: adj.names, size: adj.size, data: adj.data },
      'public/data/adjacency.json is stale — run npm run build:data',
    )
  })
})
