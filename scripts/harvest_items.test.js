// Unit + integration tests for scripts/harvest_items.js.
//
// Stdlib only (node:test + node:assert + node:sqlite). Parsers are pure, so
// extraction/entity/tag tests feed canned HTML directly (no fetch mock). DB and
// CLI tests use temp file SQLite DBs seeded with scripts/db.sql (node:sqlite
// `:memory:` DBs are per-connection and cannot be shared across the helper
// functions' reopen-by-path behavior).

import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import {
  addItemToDb,
  addRecipeForItem,
  backfillFavorites,
  main,
  parseFavoritesPageHtml,
  parseItemDetailHtml,
} from './harvest_items.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = path.join(HERE, 'harvest_items.js')
const DB_SQL_PATH = path.join(HERE, 'db.sql')

// ---------------------------------------------------------------------------
// Canned HTML snippets (verbatim from the former Python test file)
// ---------------------------------------------------------------------------

const FAVORITES_NAV_HTML = `<select>
<option value="/pokemonpokopia/habitats.shtml">Pok&eacute;mon Pokopia - Favorites Database</option>
<option value="/pokemonpokopia/favorites/blockystuff.shtml">Blocky stuff</option>
<option value="/pokemonpokopia/favorites/cleanliness.shtml">Cleanliness</option>
</select>`

const FAVORITES_PAGE_HTML = `<table>
<tr>
<td class="cen"><a href="/pokemonpokopia/items/paper.shtml"><img src="/pokemonpokopia/items/paper.png" alt="Paper" /></a></td>
<td class="cen"><a href="/pokemonpokopia/items/paper.shtml"><u>Paper</u></a></td>
<td class="cen"><a href="/pokemonpokopia/items/decoration.shtml"><img src="/pokemonpokopia/items/decoration.png" alt="Decoration" /><br />Decoration</a></td>
</tr>
<tr>
<td class="cen"><a href="/pokemonpokopia/items/wallstoragebox.shtml"><img src="/pokemonpokopia/items/wallstoragebox.png" alt="Wall storage box" /></a></td>
<td class="cen"><a href="/pokemonpokopia/items/wallstoragebox.shtml"><u>Wall storage box</u></a></td>
<td class="cen"><a href="/pokemonpokopia/items/decoration.shtml"><img src="/pokemonpokopia/items/decoration.png" alt="Decoration" /><br />Decoration</a></td>
</tr>
</table>`

// The favorites nav <select> lives on every favorites page (including
// blockystuff.shtml), so blockystuff.shtml returns nav + page content.
const BLOCKYSTUFF_PAGE_HTML = FAVORITES_NAV_HTML + FAVORITES_PAGE_HTML

const ITEMS_LISTING_HTML = `<table>
<tr><td class="cen"><a href="items/honey.shtml"><u>Honey</u></a></td></tr>
<tr><td class="cen"><a href="items/sturdystick.shtml"><u>Sturdy stick</u></a></td></tr>
</table>`

const STORAGEBOX_DETAIL_HTML = `<html><body>
<tr><td><h1>Storage box</h1></td></tr>
<tr><td class="fooevo">Picture</td></tr>
<tr>
<td class="fooinfo" align="center">
<table align="center"><tr><td class="pkmn"><img src="/pokemonpokopia/items/storagebox.png" loading="lazy" alt="Storage box" style="height:150px" /></td></tr></table>
</td></table>
<table class="tab" align="center">
<tr>
<td class="fooevo" width="25%">Category</td>
<td class="fooevo" width="25%">Tag</td>
<td class="fooevo">Paintable</td>
<td class="fooevo" width="25%">Requirements</td>
</tr>
<tr>
<td class="cen">
Furniture</td><td class="cen">
&nbsp;</td>
<td class="cen">Paint<br /></td>
<td class="cen">
</td></tr>
<tr>
<td class="fooevo" width="25%">Trade Value</td>
<td class="fooevo" width="25%">3D Print Cost</td>
<td class="fooevo" width="50%" colspan="2">Favorite Categories</td>
</tr>
<tr>
<td class="cen"><table><tr><td>Standard</td><td>50</td></tr><tr><td>Favorite:</td><td>75</td></tr></table></td>
<td class="cen"><table><tr><td><img src="/pokemonpokopia/items/pokemetal.png" height="25" alt="Pok&eacute;metal" /></td><td>2 Pok&eacute;metal</td></tr></table></td>
<td class="cen" colspan="2" valign="top">
<a href="/pokemonpokopia/favorites/woodenstuff.shtml"><u>Wooden stuff</u></a><br /></td>
</tr>
</table>
<table class="tab" align="center">
<tr><td class="fooevo"><h2>Flavor Text</h2></td></tr>
<tr><td class="fooinfo">
A convenient box you can store items in. It's made of wood and easy to move things in and out of.
</td></tr>
</table>
<table class="dextable" align="center">
<tr><td class="fooevo" colspan="3"><h2>Recipe</h2></td></tr>
<tr><td class="fooblack">Location</td><td class="fooinfo">Register 6 Pok&eacute;mon</td></tr>
<tr><td class="fooinfo" colspan="2"><table align="center">
<tr><td><a href="lumber.shtml"><img src="lumber.png" alt="Lumber" loading="lazy" height="30" /></td><td><a href="lumber.shtml"><u>Lumber</u></a> * 1</td></tr>
</table></td></tr></table>
<table class="dextable" align="center">
<tr><td class="fooevo" colspan="4"><h2>Storage box Color Variants</h2></td></tr>
</table>
</body></html>`

const GAMINGBED_DETAIL_HTML = `<html><body>
<tr><td><h1>Gaming Bed</h1></td></tr>
<tr><td class="fooevo">Picture</td></tr>
<tr>
<td class="fooinfo" align="center">
<table align="center"><tr><td class="pkmn"><img src="/pokemonpokopia/items/gamingbed.png" loading="lazy" alt="Gaming Bed" style="height:150px" /></td></tr></table>
</td></table>
<table class="tab" align="center">
<tr>
<td class="fooevo" width="25%">Category</td>
<td class="fooevo" width="25%">Tag</td>
<td class="fooevo">Paintable</td>
<td class="fooevo" width="25%">Requirements</td>
</tr>
<tr>
<td class="cen">
Relaxation</td><td class="cen">
&nbsp;</td>
<td class="cen">Paint<br /></td>
<td class="cen">
</td></tr>
<tr>
<td class="fooevo" width="25%">Trade Value</td>
<td class="fooevo" width="25%">3D Print Cost</td>
<td class="fooevo" width="50%" colspan="2">Favorite Categories</td>
</tr>
<tr>
<td class="cen"><table><tr><td>Standard</td><td>50</td></tr></table></td>
<td class="cen"><table><tr><td>2 Pok&eacute;metal</td></tr></table></td>
<td class="cen" colspan="2" valign="top">
<a href="/pokemonpokopia/favorites/woodenstuff.shtml"><u>Wooden stuff</u></a><br /></td>
</tr>
</table>
<table class="tab" align="center">
<tr><td class="fooevo"><h2>Flavor Text</h2></td></tr>
<tr><td class="fooinfo">
A game machine from a facility somewhere.
</td></tr>
</table>
<table class="dextable" align="center">
<tr><td class="fooevo" colspan="3"><h2>Recipe</h2></td></tr>
<tr><td class="fooblack">Location</td><td class="fooinfo">Shop</td></tr>
<tr><td class="fooinfo" colspan="2"><table align="center">
<tr><td><a href="pokemetal.shtml"><img src="pokemetal.png" alt="Pok&eacute;metal" loading="lazy" height="30" /></td><td><a href="pokemetal.shtml"><u>Pok&eacute;metal</u></a> * 2</td></tr>
<tr><td><a href="fluff.shtml"><img src="fluff.png" alt="Fluff" loading="lazy" height="30" /></td><td><a href="fluff.shtml"><u>Fluff</u></a> * 2</td></tr>
<tr><td><a href="goldingot.shtml"><img src="goldingot.png" alt="Gold ingot" loading="lazy" height="30" /></td><td><a href="goldingot.shtml"><u>Gold ingot</u></a> * 2</td></tr>
</table></td></tr></table>
<table class="dextable" align="center">
<tr><td class="fooevo" colspan="3"><h2>Habitats Used In</h2></td></tr>
</table>
</body></html>`

const WALLSTORAGEBOX_DETAIL_HTML = `<html><body>
<tr><td><h1>Wall storage box</h1></td></tr>
<tr><td class="fooevo">Picture</td></tr>
<tr>
<td class="fooinfo" align="center">
<table align="center"><tr><td class="pkmn"><img src="/pokemonpokopia/items/wallstoragebox.png" loading="lazy" alt="Wall storage box" style="height:150px" /></td></tr></table>
</td></table>
<table class="tab" align="center">
<tr>
<td class="fooevo" width="25%">Category</td>
<td class="fooevo" width="25%">Tag</td>
<td class="fooevo">Paintable</td>
<td class="fooevo" width="25%">Requirements</td>
</tr>
<tr>
<td class="cen">
Furniture</td><td class="cen">
<a href="decoration.shtml"><img src="decoration.png" alt="Decoration" loading="lazy" height="40" /><br />Decoration</a></td>
<td class="cen">Paint<br /></td>
<td class="cen">
</td></tr>
<tr>
<td class="fooevo" width="25%">Trade Value</td>
<td class="fooevo" width="25%">3D Print Cost</td>
<td class="fooevo" width="50%" colspan="2">Favorite Categories</td>
</tr>
<tr>
<td class="cen"><table><tr><td>Standard</td><td>50</td></tr></table></td>
<td class="cen"><table><tr><td>2 Pok&eacute;metal</td></tr></table></td>
<td class="cen" colspan="2" valign="top">
<a href="/pokemonpokopia/favorites/woodenstuff.shtml"><u>Wooden stuff</u></a><br /></td>
</tr>
</table>
<table class="tab" align="center">
<tr><td class="fooevo"><h2>Flavor Text</h2></td></tr>
<tr><td class="fooinfo">
It may be small, but it can store lots of stuff.
</td></tr>
</table>
<table class="dextable" align="center">
<tr><td class="fooevo" colspan="3"><h2>Recipe</h2></td></tr>
<tr><td class="fooinfo" colspan="2"><table align="center">
<tr><td><a href="lumber.shtml"><u>Lumber</u></a> * 2</td></tr>
</table></td></tr></table>
<table class="dextable" align="center">
<tr><td class="fooevo"><h2>Color Variants</h2></td></tr>
</table>
</body></html>`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harvest-items-'))
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

// ---------------------------------------------------------------------------
// AC.1 — CLI --help
// ---------------------------------------------------------------------------

test('CLI --help exits 0 and lists flags', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, '--help'], {
    encoding: 'utf8',
    timeout: 15_000,
  })
  assert.strictEqual(result.status, 0, result.stderr)
  assert.match(result.stdout, /--dry-run/)
  assert.match(result.stdout, /--verify/)
  assert.match(result.stdout, /--delay/)
})

// ---------------------------------------------------------------------------
// AC.4 — detail page extraction (full)
// ---------------------------------------------------------------------------

test('detail page extraction full (storagebox fixture)', () => {
  const detail = parseItemDetailHtml(STORAGEBOX_DETAIL_HTML, 'storagebox')
  assert.ok(detail)
  assert.strictEqual(detail.name, 'Storage box')
  assert.strictEqual(detail.imageUrl, '/pokemonpokopia/items/storagebox.png')
  assert.strictEqual(detail.imageFilename, 'storagebox.png')
  assert.strictEqual(detail.category, 'Furniture')
  assert.strictEqual(detail.tag, null) // &nbsp; -> null
  assert.match(detail.flavorText, /convenient box/)
  assert.strictEqual(detail.recipe.length, 1)
  assert.deepStrictEqual(detail.recipe[0], { slug: 'lumber', name: 'Lumber', count: 1 })
  assert.deepStrictEqual(detail.favorites, ['Wooden stuff'])
})

// ---------------------------------------------------------------------------
// AC.5 — multi-ingredient recipe
// ---------------------------------------------------------------------------

test('multi-ingredient recipe extraction (gamingbed fixture)', () => {
  const detail = parseItemDetailHtml(GAMINGBED_DETAIL_HTML, 'gamingbed')
  assert.ok(detail)
  assert.strictEqual(detail.recipe.length, 3)
  assert.deepStrictEqual(detail.recipe[0], { slug: 'pokemetal', name: 'Pok\u00e9metal', count: 2 })
  assert.deepStrictEqual(detail.recipe[1], { slug: 'fluff', name: 'Fluff', count: 2 })
  assert.deepStrictEqual(detail.recipe[2], { slug: 'goldingot', name: 'Gold ingot', count: 2 })
})

// ---------------------------------------------------------------------------
// AC.6 — favorites-page extraction excludes tag links
// ---------------------------------------------------------------------------

test('favorites-page extraction (blockystuff fixture)', () => {
  const results = parseFavoritesPageHtml(FAVORITES_PAGE_HTML, 'Blocky stuff')
  assert.strictEqual(results.length, 2)

  const [r0, r1] = results
  assert.strictEqual(r0.item.slug, 'paper')
  assert.strictEqual(r0.item.name, 'Paper')
  assert.strictEqual(r0.favName, 'blocky stuff')

  assert.strictEqual(r1.item.slug, 'wallstoragebox')
  assert.strictEqual(r1.item.name, 'Wall storage box')
  assert.strictEqual(r1.favName, 'blocky stuff')

  const slugs = new Set(results.map((r) => r.item.slug))
  assert.ok(!slugs.has('decoration'))
})

// ---------------------------------------------------------------------------
// AC.7 — entity unescaping + tag variants
// ---------------------------------------------------------------------------

test('entity unescaping (eacute -> e, nbsp tag -> null)', () => {
  const detail = parseItemDetailHtml(GAMINGBED_DETAIL_HTML, 'gamingbed')
  assert.ok(detail)
  assert.strictEqual(detail.recipe[0].name, 'Pok\u00e9metal')
  assert.ok(!detail.recipe[0].name.includes('&eacute;'))
  assert.strictEqual(detail.tag, null)
})

test('tag variants: nbsp -> null', () => {
  const detail = parseItemDetailHtml(STORAGEBOX_DETAIL_HTML, 'storagebox')
  assert.ok(detail)
  assert.strictEqual(detail.tag, null)
})

test('tag variants: link-wrapped -> name', () => {
  const detail = parseItemDetailHtml(WALLSTORAGEBOX_DETAIL_HTML, 'wallstoragebox')
  assert.ok(detail)
  assert.strictEqual(detail.tag, 'Decoration')
})

// ---------------------------------------------------------------------------
// AC.8 — two-pass insertion order + missing-ingredient skip
// ---------------------------------------------------------------------------

test('recipe lookup with missing ingredient warns and inserts 0 rows', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  seedTestDb(dbPath)

  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys=ON')
  db.prepare("INSERT INTO items (id, name) VALUES (1, 'Test Item')").run()
  db.close()

  const recipe = [{ slug: 'nonexistent', name: 'Nonexistent', count: 1 }]
  addRecipeForItem(dbPath, 1, recipe, new Map())

  const ro = new DatabaseSync(dbPath, { readOnly: true })
  const row = ro.prepare('SELECT COUNT(*) AS cnt FROM item_recipe').get()
  ro.close()
  assert.strictEqual(row.cnt, 0)
})

test('two-pass insertion order: items before recipes', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  seedTestDb(dbPath)

  const insertOrder = []
  const originalPrepare = DatabaseSync.prototype.prepare
  DatabaseSync.prototype.prepare = function (sql, ...rest) {
    if (String(sql).toUpperCase().includes('INSERT')) {
      insertOrder.push(String(sql))
    }
    return originalPrepare.call(this, sql, ...rest)
  }

  try {
    const id1 = addItemToDb(dbPath, 'Item A', 'images/itema.png', 'Furniture', null, 'text A')
    const id2 = addItemToDb(dbPath, 'Item B', 'images/itemb.png', 'Furniture', null, 'text B')
    const slugMap = new Map([
      ['itema', id1],
      ['itemb', id2],
    ])
    addRecipeForItem(dbPath, id2, [{ slug: 'itema', name: 'Item A', count: 2 }], slugMap)
  } finally {
    DatabaseSync.prototype.prepare = originalPrepare
  }

  const itemInserts = insertOrder
    .map((sql, i) => ({ sql, i }))
    .filter(({ sql }) => sql.includes('INTO items'))
    .map(({ i }) => i)
  const recipeInserts = insertOrder
    .map((sql, i) => ({ sql, i }))
    .filter(({ sql }) => sql.includes('INTO item_recipe'))
    .map(({ i }) => i)

  assert.ok(itemInserts.length >= 2)
  assert.ok(recipeInserts.length >= 1)
  assert.ok(Math.max(...itemInserts) < Math.min(...recipeInserts))
})

// ---------------------------------------------------------------------------
// AC.9 — favorite backfill
// ---------------------------------------------------------------------------

test('favorite backfill INSERT OR IGNORE yields both favorites', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  seedTestDb(dbPath)

  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys=ON')
  db.prepare("INSERT INTO favorites (name) VALUES ('wooden stuff')").run()
  db.prepare("INSERT INTO favorites (name) VALUES ('blocky stuff')").run()
  db.prepare(
    "INSERT INTO items (id, name, picture_path) VALUES (1, 'Storage box', 'images/storagebox.png')",
  ).run()
  db.close()

  const slugMap = new Map([['storagebox', 1]])
  const favoritesMap = new Map([['storagebox', new Set(['wooden stuff', 'blocky stuff'])]])
  const existingFavLower = new Set(['wooden stuff', 'blocky stuff'])

  backfillFavorites(dbPath, favoritesMap, slugMap, existingFavLower)

  const ro = new DatabaseSync(dbPath, { readOnly: true })
  const favs = new Set(
    ro
      .prepare('SELECT favorite_name FROM item_favorites WHERE item_id = 1')
      .all()
      .map((r) => r.favorite_name),
  )
  ro.close()
  assert.deepStrictEqual(favs, new Set(['wooden stuff', 'blocky stuff']))
})

// ---------------------------------------------------------------------------
// AC.10 — dry-run + verify integration (stubbed globalThis.fetch)
// ---------------------------------------------------------------------------

function itemsFetchMap() {
  return (url) => {
    if (url.includes('blockystuff.shtml')) {
      return BLOCKYSTUFF_PAGE_HTML
    }
    if (url.includes('cleanliness.shtml')) {
      return FAVORITES_NAV_HTML + '<table></table>'
    }
    if (url.replace(/\/+$/, '').endsWith('items.shtml')) {
      return ITEMS_LISTING_HTML
    }
    // NOTE: order matters and mirrors the Python mock exactly. "storagebox.shtml"
    // is a substring of "wallstoragebox.shtml", so wallstoragebox's detail fetch
    // actually receives the storagebox HTML (this is what makes the Python test's
    // "Storage box" substring assertion pass).
    if (url.includes('storagebox.shtml')) {
      return STORAGEBOX_DETAIL_HTML
    }
    if (url.includes('wallstoragebox.shtml')) {
      return WALLSTORAGEBOX_DETAIL_HTML
    }
    return ''
  }
}

test('dry-run integration prints DRY RUN and leaves DB untouched', async (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  const imagesDir = path.join(tmp, 'images')
  seedTestDb(dbPath)

  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys=ON')
  db.prepare("INSERT INTO favorites (name) VALUES ('wooden stuff')").run()
  db.prepare("INSERT INTO favorites (name) VALUES ('blocky stuff')").run()
  db.prepare(
    "INSERT INTO items (id, name, picture_path) VALUES (1, 'Paper', 'images/paper.png')",
  ).run()
  db.close()

  stubFetch(t, itemsFetchMap())

  const originalLog = console.log
  const chunks = []
  console.log = (...args) => chunks.push(args.join(' '))
  try {
    await main(['--dry-run', '--db', dbPath, '--images-dir', imagesDir, '--delay', '0'])
  } finally {
    console.log = originalLog
  }
  const output = chunks.join('\n')

  assert.match(output, /DRY RUN/)
  assert.match(output, /Storage box/)
  assert.match(output, /category=/)

  const ro = new DatabaseSync(dbPath, { readOnly: true })
  const row = ro.prepare('SELECT COUNT(*) AS cnt FROM items').get()
  ro.close()
  assert.strictEqual(row.cnt, 1) // only the pre-existing Paper
})

test('verify integration prints VERIFICATION REPORT', async (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  const imagesDir = path.join(tmp, 'images')
  seedTestDb(dbPath)

  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys=ON')
  db.prepare("INSERT INTO favorites (name) VALUES ('blocky stuff')").run()
  db.prepare("INSERT INTO favorites (name) VALUES ('cleanliness')").run()
  db.prepare(
    "INSERT INTO items (id, name, picture_path) VALUES (1, 'Paper', 'images/paper.png')",
  ).run()
  db.close()

  stubFetch(t, itemsFetchMap())

  const originalLog = console.log
  const chunks = []
  console.log = (...args) => chunks.push(args.join(' '))
  try {
    await main(['--verify', '--db', dbPath, '--images-dir', imagesDir, '--delay', '0'])
  } finally {
    console.log = originalLog
  }
  const output = chunks.join('\n')

  assert.match(output, /VERIFICATION REPORT/)
  assert.match(output, /Serebii unique items:/)
  assert.match(output, /DB items count:/)
  assert.match(output.toUpperCase(), /INTEGRITY/)
})
