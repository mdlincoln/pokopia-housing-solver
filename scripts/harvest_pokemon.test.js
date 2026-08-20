// Unit tests for scripts/harvest_pokemon.js.
//
// Stdlib only (node:test + node:assert). Parsers are pure, so this suite feeds
// canned HTML directly (no fetch mock). Parser coverage is net-new: the former
// Python port shipped without unit tests for its regexes.

import assert from 'node:assert'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { parsePokemonDetailHtml, parsePokemonListHtml } from './harvest_pokemon.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = path.join(HERE, 'harvest_pokemon.js')

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
