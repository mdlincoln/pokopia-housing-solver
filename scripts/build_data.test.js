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
import {
  bake,
  buildAdjacency,
  buildHabitats,
  buildItems,
  buildPokemon,
  normalizeRarity,
} from './build_data.mjs'

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

test('habitats payload: 252 habitats, valid rarity/times/weathers, existing images', () => {
  withDb((db) => {
    const habitats = buildHabitats(db)
    const ids = Object.keys(habitats).map(Number)
    assert.strictEqual(ids.length, 252)
    // Keyed by habitat id, iterated in ascending id order.
    assert.deepStrictEqual(
      ids,
      [...ids].sort((a, b) => a - b),
    )

    const VALID_RARITIES = new Set([null, 'Common', 'Rare', 'Very Rare'])
    const VALID_TIMES = new Set(['Morning', 'Day', 'Evening', 'Night'])
    const VALID_WEATHERS = new Set(['Sun', 'Cloud', 'Rain'])

    for (const habitat of Object.values(habitats)) {
      assert.strictEqual(typeof habitat.id, 'number')
      assert.strictEqual(typeof habitat.name, 'string')
      assert.ok(habitat.image.startsWith('images/habitats/'), habitat.image)
      assert.ok(fs.existsSync(path.join(PROJECT_ROOT, 'public', habitat.image)), habitat.image)
      assert.strictEqual(typeof habitat.description, 'string')
      assert.strictEqual(typeof habitat.category, 'string')
      for (const spawn of habitat.pokemon) {
        assert.ok(VALID_RARITIES.has(spawn.rarity), `${habitat.name}: ${spawn.rarity}`)
        for (const time of spawn.times) assert.ok(VALID_TIMES.has(time), time)
        for (const weather of spawn.weathers) assert.ok(VALID_WEATHERS.has(weather), weather)
        for (const location of spawn.locations) assert.strictEqual(typeof location, 'string')
      }
    }

    const spawnRowCount = Object.values(habitats).reduce((sum, h) => sum + h.pokemon.length, 0)
    assert.strictEqual(
      spawnRowCount,
      db.prepare(`SELECT COUNT(*) AS c FROM habitat_pokemon`).get().c,
    )
  })
})

test('habitats payload: Bulbasaur roster row in habitat 1 (Tall Grass)', () => {
  withDb((db) => {
    const habitats = buildHabitats(db)
    const tallGrass = habitats['1']
    assert.strictEqual(tallGrass.name, 'Tall Grass')
    const bulbasaur = tallGrass.pokemon.find((p) => p.name === 'Bulbasaur')
    assert.ok(bulbasaur)
    assert.strictEqual(bulbasaur.rarity, 'Common')
    assert.deepStrictEqual([...bulbasaur.times].sort(), ['Day', 'Evening', 'Morning', 'Night'])
    assert.deepStrictEqual([...bulbasaur.weathers].sort(), ['Cloud', 'Rain', 'Sun'])
    assert.strictEqual(bulbasaur.locations.length, 6)
    for (const location of [
      'Bleak Beach',
      'Cloud Island',
      'Palette Town',
      'Rocky Ridges',
      'Sparkling Skylands',
      'Withered Wastelands',
    ]) {
      assert.ok(bulbasaur.locations.includes(location), location)
    }
  })
})

test('habitats payload: habitat 151 roster includes Poliwrath with null rarity', () => {
  withDb((db) => {
    const habitats = buildHabitats(db)
    const habitat151 = habitats['151']
    assert.ok(habitat151)
    const poliwrath = habitat151.pokemon.find((p) => p.name === 'Poliwrath')
    assert.ok(poliwrath)
    assert.strictEqual(poliwrath.rarity, null)
  })
})

test('habitats payload: rarity normalization (CommonCommon → Common)', () => {
  assert.strictEqual(normalizeRarity('Common'), 'Common')
  assert.strictEqual(normalizeRarity('Rare'), 'Rare')
  assert.strictEqual(normalizeRarity('Very Rare'), 'Very Rare')
  assert.strictEqual(normalizeRarity('CommonCommon'), 'Common')
  assert.strictEqual(normalizeRarity(null), null)
  assert.strictEqual(normalizeRarity(undefined), null)
  assert.strictEqual(normalizeRarity('garbage'), null)
})

test('pokemon payload: spawnHabitats arrays ordered by habitat number, omitted when no spawns', () => {
  withDb((db) => {
    const { names, dataByName } = buildPokemon(db)

    // Bulbasaur spawns in habitats 1 (Tall Grass) and 22 (Bench with greenery).
    assert.deepStrictEqual(dataByName['Bulbasaur'].spawnHabitats, [
      { id: 1, name: 'Tall Grass', image: 'images/habitats/1.png' },
      { id: 22, name: 'Bench with greenery', image: 'images/habitats/22.png' },
    ])

    // Every spawnHabitats image resolves to an existing file under public/.
    let spawnPokemonCount = 0
    for (const name of names) {
      const d = dataByName[name]
      if (!d.spawnHabitats) continue
      spawnPokemonCount++
      for (const habitat of d.spawnHabitats) {
        assert.ok(habitat.image.startsWith('images/habitats/'), habitat.image)
        assert.ok(fs.existsSync(path.join(PROJECT_ROOT, 'public', habitat.image)), habitat.image)
        assert.strictEqual(typeof habitat.id, 'number')
        assert.strictEqual(typeof habitat.name, 'string')
      }
    }

    // Counts match the DB: pokemon present in habitat_pokemon AND in the
    // pokemon catalog get the key. Porygon-Z appears in rosters but not in
    // the catalog, so it can't appear in pokemon.json; Articuno spawns
    // nowhere so its entry gets the key omitted.
    const dbSpawnPokemon = new Set(
      db
        .prepare(`SELECT DISTINCT pokemon_name FROM habitat_pokemon`)
        .all()
        .map((r) => r.pokemon_name),
    )
    const hydratableSpawnPokemon = names.filter((name) => dbSpawnPokemon.has(name))
    assert.strictEqual(spawnPokemonCount, hydratableSpawnPokemon.length)
    assert.ok(!dbSpawnPokemon.has('Articuno'))
    assert.ok(!('spawnHabitats' in dataByName['Articuno']))
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

    // favoritesByItem derives from the same ordered loop; assert it too.
    const expectedByItem = {}
    for (const row of rows) {
      ;(expectedByItem[row.item_name] ??= []).push(row.favorite_name)
    }
    assert.deepStrictEqual(graph.favoritesByItem, expectedByItem)
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
        const habitats = buildHabitats(db)
        const adjacency = buildAdjacency(db)
        return [
          JSON.stringify(pokemon),
          JSON.stringify(items),
          JSON.stringify(habitats),
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
// File-write: bake() writes all three output files to disk and they parse as
// valid JSON. Covers the main() → disk path that the individual build* tests
// don't exercise (they call build* directly, never touching output paths).
// ---------------------------------------------------------------------------

test('bake() writes all four output files and they parse as JSON', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-data-write-'))
  const snapshotDb = path.join(tmp, 'pokehousing.sqlite')
  fs.copyFileSync(DEFAULT_DB_PATH, snapshotDb)
  try {
    const stats = bake(snapshotDb, tmp)
    const { pokemonOut, itemsOut, habitatsOut, adjacencyOut } = stats.paths

    assert.ok(fs.statSync(pokemonOut).size > 0, 'pokemon.json was written')
    assert.ok(fs.statSync(itemsOut).size > 0, 'items.json was written')
    assert.ok(fs.statSync(habitatsOut).size > 0, 'habitats.json was written')
    assert.ok(fs.statSync(adjacencyOut).size > 0, 'adjacency.json was written')

    const pokemon = JSON.parse(fs.readFileSync(pokemonOut, 'utf8'))
    assert.ok(Array.isArray(pokemon.names))
    assert.ok(typeof pokemon.dataByName === 'object')

    const items = JSON.parse(fs.readFileSync(itemsOut, 'utf8'))
    assert.ok(typeof items.itemDetailsByName === 'object')

    const habitats = JSON.parse(fs.readFileSync(habitatsOut, 'utf8'))
    assert.strictEqual(Object.keys(habitats).length, 252)
    assert.ok(Array.isArray(habitats['1'].pokemon))

    const adjacency = JSON.parse(fs.readFileSync(adjacencyOut, 'utf8'))
    assert.ok(Array.isArray(adjacency.names))
    assert.ok(typeof adjacency.size === 'number')
    assert.ok(typeof adjacency.data === 'string')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
