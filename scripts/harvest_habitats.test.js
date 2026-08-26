// Unit tests for scripts/harvest_habitats.js.
//
// Stdlib only (node:test + node:assert + node:sqlite). Parsers are pure, so
// extraction tests feed canned HTML directly (no fetch mock). DB and CLI tests
// use temp file SQLite DBs seeded with scripts/db.sql.

import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import {
  addHabitatPokemon,
  addHabitatRecipe,
  addHabitatToDb,
  createTables,
  findMissingHabitats,
  getExistingHabitats,
  main,
  parseHabitatDetailHtml,
  parseHabitatListHtml,
} from './harvest_habitats.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = path.join(HERE, 'harvest_habitats.js')
const DB_SQL_PATH = path.join(HERE, 'db.sql')

// ---------------------------------------------------------------------------
// Canned HTML snippets (based on actual Serebii page structure)
// ---------------------------------------------------------------------------

const LIST_HTML = `<table align="center" class="dextable">
	<tr>
		<td class="fooevo">No.</td>
		<td class="fooevo">Picture</td>
		<td class="fooevo">Name</td>
		<td class="fooevo">Description</td>
	</tr><a name="main"></a>
	<tr>
		<td class="cen">#001</td>
		<td class="cen"><a href="habitatdex/tallgrass.shtml"><img src="habitatdex/th/1.png" style="max-height:60px" alt="Tall Grass" loading="lazy" /></a></td>
		<td class="fooinfo"><a href="habitatdex/tallgrass.shtml"><u>Tall Grass</u></a></td>
		<td class="fooinfo">Four tufts of tall grass bunched together in a plot. The perfect hiding place for small Pok&eacute;mon</td>
	</tr>
	<tr>
		<td class="cen">#002</td>
		<td class="cen"><a href="habitatdex/treeshadedtallgrass.shtml"><img src="habitatdex/th/2.png" style="max-height:60px" alt="Tree-shaded tall grass" loading="lazy" /></a></td>
		<td class="fooinfo"><a href="habitatdex/treeshadedtallgrass.shtml"><u>Tree-shaded tall grass</u></a></td>
		<td class="fooinfo">Shaded tall grass that stays cool, even in the midday sun.</td>
	</tr>
	<tr><td class="fooevo" colspan="4"><a name="basin"></a>Habitats (Basin)</td></tr><tr>
		<td class="cen">#001</td>
		<td class="cen"><a href="habitatdex/basintallgrass.shtml"><img src="habitatdex/th/b1.png" style="max-height:60px" alt="Basin tall grass" loading="lazy" /></a></td>
		<td class="fooinfo"><a href="habitatdex/basintallgrass.shtml"><u>Basin tall grass</u></a></td>
		<td class="fooinfo">Tall grass that stays near the water.</td>
	</tr>
	<tr><td class="fooevo" colspan="4"><a name="event"></a>Habitats (Event)</td></tr><tr>
		<td class="cen">#001</td>
		<td class="cen"><a href="habitatdex/yellowcarpet.shtml"><img src="habitatdex/th/e1.png" style="max-height:60px" alt="Yellow carpet" loading="lazy" /></a></td>
		<td class="fooinfo"><a href="habitatdex/yellowcarpet.shtml"><u>Yellow carpet</u></a></td>
		<td class="fooinfo">A bright yellow carpet.</td>
	</tr>
</table>`

// A detail page with a 4-column pokemon batch (mirrors real Serebii structure).
const DETAIL_HTML = `<html><body>
<h1>Tall Grass</h1></td></tr>
<tr>
<td class="fooevo">Picture</td>
</tr>
<tr>
<td class="cen">
<table align="center"><tr><td class="pkmn"><img src="/pokemonpokopia/habitatdex/1.png" loading="lazy" alt="Tall Grass" style="height:250px" /></td></tr></table>
</td></table>
<table class="tab" align="center" >
<tr>
<td class="fooevo"><h2>Flavor Text</h2></td>
</tr>
<tr>
<td class="fooinfo" >
Four tufts of tall grass bunched together in a plot. The perfect hiding place for small Pok&eacute;mon
</td>
</tr>
</table>
<p><h2>Requirements</h2></p>
<table class="dextable" align="center">
<tr>
<td class="fooevo">Image</td>
<td class="fooevo">Name</td>
<td class="fooevo">Quantity</td>
</tr>
<tr><td class="cen"><a href="/pokemonpokopia/items/tallgrass.shtml"><img src="/pokemonpokopia/items/tallgrass.png" height="40" alt="Tall Grass" loading="lazy" /></td>
<td class="fooinfo"><a href="/pokemonpokopia/items/tallgrass.shtml"><u>Tall Grass</u></a></td>
<td class="fooinfo">4</td>
</tr></table>
<p><h2>Available Pok&eacute;mon</h2></p>
<table class="dextable" align="center" >
<tr>
<td class="fooevo"><a href="/pokemonpokopia/pokedex/bulbasaur.shtml">Bulbasaur</a></td>
<td class="fooevo"><a href="/pokemonpokopia/pokedex/charmander.shtml">Charmander</a></td>
<td class="fooevo"><a href="/pokemonpokopia/pokedex/squirtle.shtml">Squirtle</a></td>
<td class="fooevo"><a href="/pokemonpokopia/pokedex/geodude.shtml">Geodude</a></td>
</tr>
<tr>
<td class="cen"><a href="/pokemonpokopia/pokedex/bulbasaur.shtml"><img src="/pokemonpokopia/pokemon/small/001.png" loading="lazy" alt="Bulbasaur" /></a></td>
<td class="cen"><a href="/pokemonpokopia/pokedex/charmander.shtml"><img src="/pokemonpokopia/pokemon/small/004.png" loading="lazy" alt="Charmander" /></a></td>
<td class="cen"><a href="/pokemonpokopia/pokedex/squirtle.shtml"><img src="/pokemonpokopia/pokemon/small/007.png" loading="lazy" alt="Squirtle" /></a></td>
<td class="cen"><a href="/pokemonpokopia/pokedex/geodude.shtml"><img src="/pokemonpokopia/pokemon/small/074.png" loading="lazy" alt="Geodude" /></a></td>
</tr>
<tr>
<td class="fooinfo" valign="top"><b>Location</b>:<br />
<a href="/pokemonpokopia/locations/witheredwastelands.shtml"><u>Withered Wastelands</u></a><br /><a href="/pokemonpokopia/locations/bleakbeach.shtml"><u>Bleak Beach</u></a><br /></td>
<td class="fooinfo" valign="top"><b>Location</b>:<br />
<a href="/pokemonpokopia/locations/palettetown.shtml"><u>Palette Town</u></a><br /></td>
<td class="fooinfo" valign="top"><b>Location</b>:<br />
<a href="/pokemonpokopia/locations/rockyridges.shtml"><u>Rocky Ridges</u></a><br /><a href="/pokemonpokopia/locations/sparklingskylands.shtml"><u>Sparkling Skylands</u></a><br /></td>
<td class="fooinfo" valign="top"><b>Location</b>:<br />
<a href="/pokemonpokopia/locations/cloudisland.shtml"><u>Cloud Island</u></a><br /></td>
</tr>
<tr>
<td class="fooinfo"><b>Rarity</b>:<br />Common</td>
<td class="fooinfo"><b>Rarity</b>:<br />Common</td>
<td class="fooinfo"><b>Rarity</b>:<br />Rare</td>
<td class="fooinfo"><b>Rarity</b>:<br />Common</td>
</tr>
<tr>
<td class="fooinfo">
<table align="center" width="100%"><tr><td width="50%" align="center"><b>Time</b></td><td width="50%" align="center"><b>Weather</b></td></tr>
<tr><td valign="top"><br />Morning<br />Day<br />Evening<br />Night</td>
<td valign="top"><br />Sun<br />Cloud<br />Rain</td></tr></table>
</td>
<td class="fooinfo">
<table align="center" width="100%"><tr><td width="50%" align="center"><b>Time</b></td><td width="50%" align="center"><b>Weather</b></td></tr>
<tr><td valign="top"><br />Morning<br />Day</td>
<td valign="top"><br />Sun</td></tr></table>
</td>
<td class="fooinfo">
<table align="center" width="100%"><tr><td width="50%" align="center"><b>Time</b></td><td width="50%" align="center"><b>Weather</b></td></tr>
<tr><td valign="top"><br />Night</td>
<td valign="top"><br />Rain</td></tr></table>
</td>
<td class="fooinfo">
<table align="center" width="100%"><tr><td width="50%" align="center"><b>Time</b></td><td width="50%" align="center"><b>Weather</b></td></tr>
<tr><td valign="top"><br />Morning<br />Day<br />Evening<br />Night</td>
<td valign="top"><br />Sun<br />Cloud<br />Rain</td></tr></table>
</td>
</tr>
<tr>
<td class="fooevo"><a href="/pokemonpokopia/pokedex/oddish.shtml">Oddish</a></td>
<td class="fooevo"><a href="/pokemonpokopia/pokedex/charizard.shtml">Charizard</a></td>
</tr>
<tr>
<td class="cen"><a href="/pokemonpokopia/pokedex/oddish.shtml"><img src="/pokemonpokopia/pokemon/small/043.png" loading="lazy" alt="Oddish" /></a></td>
<td class="cen"><a href="/pokemonpokopia/pokedex/charizard.shtml"><img src="/pokemonpokopia/pokemon/small/006.png" loading="lazy" alt="Charizard" /></a></td>
</tr>
<tr>
<td class="fooinfo" valign="top"><b>Location</b>:<br />
<a href="/pokemonpokopia/locations/palettetown.shtml"><u>Palette Town</u></a><br /></td>
<td class="fooinfo" valign="top"><b>Location</b>:<br />
<a href="/pokemonpokopia/locations/cloudisland.shtml"><u>Cloud Island</u></a><br /></td>
</tr>
<tr>
<td class="fooinfo"><b>Rarity</b>:<br />Uncommon</td>
<td class="fooinfo"><b>Rarity</b>:<br />Rare</td>
</tr>
<tr>
<td class="fooinfo">
<table align="center" width="100%"><tr><td width="50%" align="center"><b>Time</b></td><td width="50%" align="center"><b>Weather</b></td></tr>
<tr><td valign="top"><br />Day<br />Evening</td>
<td valign="top"><br />Sun<br />Cloud</td></tr></table>
</td>
<td class="fooinfo">
<table align="center" width="100%"><tr><td width="50%" align="center"><b>Time</b></td><td width="50%" align="center"><b>Weather</b></td></tr>
<tr><td valign="top"><br />Night</td>
<td valign="top"><br />Rain<br />Snow</td></tr></table>
</td>
</tr>
</table>
</body></html>`

// A Basin habitat detail page with letter-prefixed image basename.
const BASIN_DETAIL_HTML = `<html><body>
<h1>Basin tall grass</h1></td></tr>
<tr><td class="fooevo">Picture</td></tr>
<tr>
<td class="cen">
<table align="center"><tr><td class="pkmn"><img src="/pokemonpokopia/habitatdex/b1.png" loading="lazy" alt="Basin tall grass" style="height:250px" /></td></tr></table>
</td></table>
<table class="tab" align="center" >
<tr><td class="fooevo"><h2>Flavor Text</h2></td></tr>
<tr><td class="fooinfo" >Tall grass that stays near the water.</td></tr>
</table>
<p><h2>Requirements</h2></p>
<table class="dextable" align="center">
<tr><td class="fooevo">Image</td><td class="fooevo">Name</td><td class="fooevo">Quantity</td></tr>
<tr><td class="cen"><a href="/pokemonpokopia/items/lumber.shtml"><img src="/pokemonpokopia/items/lumber.png" height="40" alt="Lumber" loading="lazy" /></td>
<td class="fooinfo"><a href="/pokemonpokopia/items/lumber.shtml"><u>Lumber</u></a></td>
<td class="fooinfo">2</td>
</tr>
<tr><td class="cen"><a href="/pokemonpokopia/items/fluff.shtml"><img src="/pokemonpokopia/items/fluff.png" height="40" alt="Fluff" loading="lazy" /></td>
<td class="fooinfo"><a href="/pokemonpokopia/items/fluff.shtml"><u>Fluff</u></a></td>
<td class="fooinfo">3</td>
</tr></table>
<p><h2>Available Pok&eacute;mon</h2></p>
<table class="dextable" align="center" >
<tr><td class="fooevo"><a href="/pokemonpokopia/pokedex/psyduck.shtml">Psyduck</a></td></tr>
<tr><td class="cen"><a href="/pokemonpokopia/pokedex/psyduck.shtml"><img src="/pokemonpokopia/pokemon/small/054.png" loading="lazy" alt="Psyduck" /></a></td>
<tr>
<td class="fooinfo" valign="top"><b>Location</b>:<br />
<a href="/pokemonpokopia/locations/palettetown.shtml"><u>Palette Town</u></a><br /></td>
</tr>
<tr><td class="fooinfo"><b>Rarity</b>:<br />Common</td></tr>
<tr>
<td class="fooinfo">
<table align="center" width="100%"><tr><td width="50%" align="center"><b>Time</b></td><td width="50%" align="center"><b>Weather</b></td></tr>
<tr><td valign="top"><br />Morning<br />Day<br />Evening<br />Night</td>
<td valign="top"><br />Sun<br />Rain</td></tr></table>
</td>
</tr>
</table>
</body></html>`

// A detail page with no recipe and no pokemon (edge case).
const EMPTY_DETAIL_HTML = `<html><body>
<h1>Empty Habitat</h1></td></tr>
<tr><td class="fooevo">Picture</td></tr>
<tr>
<td class="cen">
<table align="center"><tr><td class="pkmn"><img src="/pokemonpokopia/habitatdex/99.png" loading="lazy" alt="Empty Habitat" style="height:250px" /></td></tr></table>
</td></table>
<table class="tab" align="center" >
<tr><td class="fooevo"><h2>Flavor Text</h2></td></tr>
<tr><td class="fooinfo" >An empty habitat with nothing special.</td></tr>
</table>
<p><h2>Requirements</h2></p>
<table class="dextable" align="center">
<tr><td class="fooevo">Image</td><td class="fooevo">Name</td><td class="fooevo">Quantity</td></tr>
</table>
<p><h2>Available Pok&eacute;mon</h2></p>
<table class="dextable" align="center" >
</table>
</body></html>`

// A detail page with a batch where one pokemon's time/weather data is malformed.
const MALFORMED_TW_DETAIL_HTML = `<html><body>
<h1>Test Habitat</h1></td></tr>
<tr><td class="fooevo">Picture</td></tr>
<tr>
<td class="cen">
<table align="center"><tr><td class="pkmn"><img src="/pokemonpokopia/habitatdex/42.png" loading="lazy" alt="Test Habitat" style="height:250px" /></td></tr></table>
</td></table>
<table class="tab" align="center" >
<tr><td class="fooevo"><h2>Flavor Text</h2></td></tr>
<tr><td class="fooinfo" >Testing robustness.</td></tr>
</table>
<p><h2>Available Pok&eacute;mon</h2></p>
<table class="dextable" align="center" >
<tr>
<td class="fooevo"><a href="/pokemonpokopia/pokedex/pikachu.shtml">Pikachu</a></td>
<td class="fooevo"><a href="/pokemonpokopia/pokedex/raichu.shtml">Raichu</a></td>
<td class="fooevo"><a href="/pokemonpokopia/pokedex/sandshrew.shtml">Sandshrew</a></td>
</tr>
<tr>
<td class="cen"><a href="/pokemonpokopia/pokedex/pikachu.shtml"><img src="/pokemonpokopia/pokemon/small/025.png" loading="lazy" alt="Pikachu" /></a></td>
<td class="cen"><a href="/pokemonpokopia/pokedex/raichu.shtml"><img src="/pokemonpokopia/pokemon/small/026.png" loading="lazy" alt="Raichu" /></a></td>
<td class="cen"><a href="/pokemonpokopia/pokedex/sandshrew.shtml"><img src="/pokemonpokopia/pokemon/small/027.png" loading="lazy" alt="Sandshrew" /></a></td>
</tr>
<tr>
<td class="fooinfo" valign="top"><b>Location</b>:<br /><a href="/pokemonpokopia/locations/palettetown.shtml"><u>Palette Town</u></a><br /></td>
<td class="fooinfo" valign="top"><b>Location</b>:<br /><a href="/pokemonpokopia/locations/cloudisland.shtml"><u>Cloud Island</u></a><br /></td>
<td class="fooinfo" valign="top"><b>Location</b>:<br /><a href="/pokemonpokopia/locations/rockyridges.shtml"><u>Rocky Ridges</u></a><br /></td>
</tr>
<tr>
<td class="fooinfo"><b>Rarity</b>:<br />Common</td>
<td class="fooinfo"><b>Rarity</b>:<br />Rare</td>
<td class="fooinfo"><b>Rarity</b>:<br />Common</td>
</tr>
<tr>
<td class="fooinfo">
<table align="center" width="100%"><tr><td width="50%" align="center"><b>Time</b></td><td width="50%" align="center"><b>Weather</b></td></tr>
<tr><td valign="top"><br />Day</td><td valign="top"><br />Sun</td></tr></table>
</td>
<td class="fooinfo">&nbsp;</td>
<td class="fooinfo">
<table align="center" width="100%"><tr><td width="50%" align="center"><b>Time</b></td><td width="50%" align="center"><b>Weather</b></td></tr>
<tr><td valign="top"><br />Night</td><td valign="top"><br />Rain</td></tr></table>
</td>
</tr>
</table>
</body></html>`

// A detail page missing the image (should return null).
const NO_IMAGE_DETAIL_HTML = `<html><body>
<h1>No Image Habitat</h1></td></tr>
<table class="tab" align="center" >
<tr><td class="fooevo"><h2>Flavor Text</h2></td></tr>
<tr><td class="fooinfo" >Has flavor text but no image.</td></tr>
</table>
</body></html>`

// A detail page missing the flavor text (should return null).
const NO_FLAVOR_DETAIL_HTML = `<html><body>
<h1>No Flavor Habitat</h1></td></tr>
<tr><td class="fooevo">Picture</td></tr>
<tr>
<td class="cen">
<table align="center"><tr><td class="pkmn"><img src="/pokemonpokopia/habitatdex/50.png" loading="lazy" alt="No Flavor Habitat" style="height:250px" /></td></tr></table>
</td></table>
</body></html>`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harvest-habitats-'))
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
  assert.match(result.stdout, /--images-dir/)
})

// ---------------------------------------------------------------------------
// AC.2 — parseHabitatListHtml
// ---------------------------------------------------------------------------

test('parseHabitatListHtml extracts entries and categories', () => {
  const entries = parseHabitatListHtml(LIST_HTML)
  assert.ok(entries.length >= 4, `expected >=4 entries, got ${entries.length}`)

  // First entry — main habitat
  const e0 = entries[0]
  assert.strictEqual(e0.number, 1)
  assert.strictEqual(e0.name, 'Tall Grass')
  assert.strictEqual(e0.slug, 'tallgrass')
  assert.strictEqual(e0.thumbnailBasename, '1')
  assert.strictEqual(e0.category, 'main')
  assert.match(e0.description, /Four tufts of tall grass/)

  // Second entry — still main
  const e1 = entries[1]
  assert.strictEqual(e1.category, 'main')
  assert.strictEqual(e1.name, 'Tree-shaded tall grass')

  // Basin entry — category switched at section divider
  const basin = entries.find((e) => e.name === 'Basin tall grass')
  assert.ok(basin, 'Basin tall grass entry not found')
  assert.strictEqual(basin.category, 'basin')
  assert.strictEqual(basin.number, 1) // resets
  assert.strictEqual(basin.thumbnailBasename, 'b1')

  // Event entry — category switched
  const event = entries.find((e) => e.name === 'Yellow carpet')
  assert.ok(event, 'Yellow carpet entry not found')
  assert.strictEqual(event.category, 'event')
  assert.strictEqual(event.thumbnailBasename, 'e1')
})

test('parseHabitatListHtml skips header and section-divider rows', () => {
  const entries = parseHabitatListHtml(LIST_HTML)
  // No entry should be all-header text or section divider text
  for (const e of entries) {
    assert.ok(e.number > 0, `entry ${e.name} has no number`)
    assert.ok(e.slug, `entry ${e.name} has no slug`)
    assert.ok(e.name, `entry has no name`)
  }
})

// ---------------------------------------------------------------------------
// AC.3 — parseHabitatDetailHtml (full extraction)
// ---------------------------------------------------------------------------

test('parseHabitatDetailHtml extracts image, flavor, recipe, pokemon', () => {
  const detail = parseHabitatDetailHtml(DETAIL_HTML, 'tallgrass')
  assert.ok(detail)

  // Image
  assert.strictEqual(detail.imageUrl, '/pokemonpokopia/habitatdex/1.png')
  assert.strictEqual(detail.imageNumber, '1')

  // Name
  assert.strictEqual(detail.name, 'Tall Grass')

  // Flavor text
  assert.match(detail.flavorText, /Four tufts of tall grass/)

  // Recipe
  assert.strictEqual(detail.recipe.length, 1)
  assert.deepStrictEqual(detail.recipe[0], { name: 'Tall Grass', quantity: 4 })

  // Pokemon
  assert.ok(detail.pokemon.length >= 4, `expected >=4 pokemon, got ${detail.pokemon.length}`)

  // First pokemon — Bulbasaur
  const bulbasaur = detail.pokemon[0]
  assert.strictEqual(bulbasaur.name, 'Bulbasaur')
  assert.strictEqual(bulbasaur.rarity, 'Common')
  assert.deepStrictEqual(bulbasaur.locations, ['Withered Wastelands', 'Bleak Beach'])
  assert.deepStrictEqual(bulbasaur.times, ['Morning', 'Day', 'Evening', 'Night'])
  assert.deepStrictEqual(bulbasaur.weathers, ['Sun', 'Cloud', 'Rain'])

  // Third pokemon — Squirtle (Rare)
  const squirtle = detail.pokemon[2]
  assert.strictEqual(squirtle.name, 'Squirtle')
  assert.strictEqual(squirtle.rarity, 'Rare')
  assert.deepStrictEqual(squirtle.locations, ['Rocky Ridges', 'Sparkling Skylands'])
  assert.deepStrictEqual(squirtle.times, ['Night'])
  assert.deepStrictEqual(squirtle.weathers, ['Rain'])
})

// ---------------------------------------------------------------------------
// AC.4 — multi-column pokemon batches
// ---------------------------------------------------------------------------

test('parseHabitatDetailHtml handles multi-column pokemon batches', () => {
  const detail = parseHabitatDetailHtml(DETAIL_HTML, 'tallgrass')
  assert.ok(detail)

  // First batch has 4 pokemon
  const batch1 = detail.pokemon.slice(0, 4)
  assert.strictEqual(batch1.length, 4)
  assert.deepStrictEqual(
    batch1.map((p) => p.name),
    ['Bulbasaur', 'Charmander', 'Squirtle', 'Geodude'],
  )

  // Each pokemon has correct rarity paired by column
  assert.strictEqual(batch1[0].rarity, 'Common') // Bulbasaur
  assert.strictEqual(batch1[1].rarity, 'Common') // Charmander
  assert.strictEqual(batch1[2].rarity, 'Rare') // Squirtle
  assert.strictEqual(batch1[3].rarity, 'Common') // Geodude

  // Each pokemon has correct locations paired by column
  assert.deepStrictEqual(batch1[0].locations, ['Withered Wastelands', 'Bleak Beach'])
  assert.deepStrictEqual(batch1[1].locations, ['Palette Town'])
  assert.deepStrictEqual(batch1[2].locations, ['Rocky Ridges', 'Sparkling Skylands'])
  assert.deepStrictEqual(batch1[3].locations, ['Cloud Island'])

  // Second batch has 2 pokemon
  const batch2 = detail.pokemon.slice(4)
  assert.strictEqual(batch2.length, 2)
  assert.deepStrictEqual(
    batch2.map((p) => p.name),
    ['Oddish', 'Charizard'],
  )
  assert.strictEqual(batch2[0].rarity, 'Uncommon')
  assert.strictEqual(batch2[1].rarity, 'Rare')
})

// ---------------------------------------------------------------------------
// parseHabitatDetailHtml — edge cases
// ---------------------------------------------------------------------------

test('parseHabitatDetailHtml: single-pokemon habitat (1 column)', () => {
  const detail = parseHabitatDetailHtml(BASIN_DETAIL_HTML, 'basintallgrass')
  assert.ok(detail)
  assert.strictEqual(detail.imageNumber, 'b1')
  assert.strictEqual(detail.imageUrl, '/pokemonpokopia/habitatdex/b1.png')
  assert.strictEqual(detail.name, 'Basin tall grass')

  // Recipe with 2 items
  assert.strictEqual(detail.recipe.length, 2)
  assert.deepStrictEqual(detail.recipe[0], { name: 'Lumber', quantity: 2 })
  assert.deepStrictEqual(detail.recipe[1], { name: 'Fluff', quantity: 3 })

  // Single pokemon
  assert.strictEqual(detail.pokemon.length, 1)
  assert.strictEqual(detail.pokemon[0].name, 'Psyduck')
  assert.strictEqual(detail.pokemon[0].rarity, 'Common')
  assert.deepStrictEqual(detail.pokemon[0].locations, ['Palette Town'])
  assert.deepStrictEqual(detail.pokemon[0].times, ['Morning', 'Day', 'Evening', 'Night'])
  assert.deepStrictEqual(detail.pokemon[0].weathers, ['Sun', 'Rain'])
})

test('parseHabitatDetailHtml: no recipe items and no pokemon', () => {
  const detail = parseHabitatDetailHtml(EMPTY_DETAIL_HTML, 'emptyhabitat')
  assert.ok(detail)
  assert.strictEqual(detail.recipe.length, 0)
  assert.strictEqual(detail.pokemon.length, 0)
  assert.strictEqual(detail.imageNumber, '99')
  assert.match(detail.flavorText, /An empty habitat/)
})

test('parseHabitatDetailHtml: basin/event letter-prefixed image basename', () => {
  const detail = parseHabitatDetailHtml(BASIN_DETAIL_HTML, 'basintallgrass')
  assert.ok(detail)
  assert.strictEqual(detail.imageNumber, 'b1')

  // Event example
  const eventHtml = BASIN_DETAIL_HTML.replace(
    'habitatdex/b1.png',
    'habitatdex/e7.png',
  ).replace('Basin tall grass', 'Event habitat')
  const eventDetail = parseHabitatDetailHtml(eventHtml, 'eventhabitat')
  assert.ok(eventDetail)
  assert.strictEqual(eventDetail.imageNumber, 'e7')
})

test('parseHabitatDetailHtml returns null on missing image', () => {
  const detail = parseHabitatDetailHtml(NO_IMAGE_DETAIL_HTML, 'noimage')
  assert.strictEqual(detail, null)
})

test('parseHabitatDetailHtml returns null on missing flavor text', () => {
  const detail = parseHabitatDetailHtml(NO_FLAVOR_DETAIL_HTML, 'noflavor')
  assert.strictEqual(detail, null)
})

// ---------------------------------------------------------------------------
// parseHabitatDetailHtml — per-batch robustness
// ---------------------------------------------------------------------------

test('parseHabitatDetailHtml: missing time/weather cell does not desync batch', () => {
  const detail = parseHabitatDetailHtml(MALFORMED_TW_DETAIL_HTML, 'testhabitat')
  assert.ok(detail)
  assert.strictEqual(detail.pokemon.length, 3)

  // Pikachu has normal time/weather
  const pikachu = detail.pokemon[0]
  assert.strictEqual(pikachu.name, 'Pikachu')
  assert.deepStrictEqual(pikachu.times, ['Day'])
  assert.deepStrictEqual(pikachu.weathers, ['Sun'])

  // Raichu has no time/weather data (malformed cell)
  const raichu = detail.pokemon[1]
  assert.strictEqual(raichu.name, 'Raichu')
  // times/weathers may be empty — the key is that it doesn't desync the others
  assert.ok(raichu.times !== undefined)

  // Sandshrew still pairs correctly despite Raichu's missing data
  const sandshrew = detail.pokemon[2]
  assert.strictEqual(sandshrew.name, 'Sandshrew')
  assert.deepStrictEqual(sandshrew.times, ['Night'])
  assert.deepStrictEqual(sandshrew.weathers, ['Rain'])
  assert.strictEqual(sandshrew.rarity, 'Common')
  assert.deepStrictEqual(sandshrew.locations, ['Rocky Ridges'])
})

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

test('DB helpers: createTables on empty DB', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)

  // Create tables on a fresh DB (no prior schema)
  createTables(dbPath)

  const ro = new DatabaseSync(dbPath, { readOnly: true })
  const tables = ro
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('serebii_habitats', 'habitat_recipe', 'habitat_pokemon')")
    .all()
    .map((r) => r.name)
  ro.close()

  assert.strictEqual(tables.length, 3)
  assert.ok(tables.includes('serebii_habitats'))
  assert.ok(tables.includes('habitat_recipe'))
  assert.ok(tables.includes('habitat_pokemon'))
})

test('DB helpers: createTables is idempotent', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)

  createTables(dbPath)
  createTables(dbPath) // should not throw

  const ro = new DatabaseSync(dbPath, { readOnly: true })
  const count = ro
    .prepare("SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='serebii_habitats'")
    .get()
  ro.close()
  assert.strictEqual(count.cnt, 1)
})

test('DB helpers: addHabitatToDb returns valid habitatId', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  createTables(dbPath)

  const id = addHabitatToDb(dbPath, 1, 'Tall Grass', 'tallgrass', 'images/habitats/1.png', 'desc', 'main')
  assert.strictEqual(typeof id, 'number')
  assert.ok(id > 0)

  const ro = new DatabaseSync(dbPath, { readOnly: true })
  const row = ro.prepare('SELECT * FROM serebii_habitats WHERE id = ?').get(id)
  ro.close()
  assert.strictEqual(row.name, 'Tall Grass')
  assert.strictEqual(row.number, 1)
  assert.strictEqual(row.detail_slug, 'tallgrass')
  assert.strictEqual(row.image_path, 'images/habitats/1.png')
  assert.strictEqual(row.category, 'main')
})

test('DB helpers: addHabitatRecipe inserts item_name and quantity', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  createTables(dbPath)

  const id = addHabitatToDb(dbPath, 1, 'Tall Grass', 'tallgrass', 'img', 'desc', 'main')
  addHabitatRecipe(dbPath, id, [
    { name: 'Tall Grass', quantity: 4 },
    { name: 'Lumber', quantity: 2 },
  ])

  const ro = new DatabaseSync(dbPath, { readOnly: true })
  const rows = ro
    .prepare('SELECT item_name, quantity FROM habitat_recipe WHERE habitat_id = ? ORDER BY item_name')
    .all(id)
  ro.close()

  assert.strictEqual(rows.length, 2)
  assert.strictEqual(rows[0].item_name, 'Lumber')
  assert.strictEqual(rows[0].quantity, 2)
  assert.strictEqual(rows[1].item_name, 'Tall Grass')
  assert.strictEqual(rows[1].quantity, 4)
})

test('DB helpers: addHabitatPokemon inserts pipe-joined fields', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  createTables(dbPath)

  const id = addHabitatToDb(dbPath, 1, 'Tall Grass', 'tallgrass', 'img', 'desc', 'main')
  addHabitatPokemon(dbPath, id, [
    {
      name: 'Bulbasaur',
      rarity: 'Common',
      locations: ['Withered Wastelands', 'Bleak Beach'],
      times: ['Morning', 'Day'],
      weathers: ['Sun', 'Rain'],
    },
  ])

  const ro = new DatabaseSync(dbPath, { readOnly: true })
  const row = ro
    .prepare('SELECT * FROM habitat_pokemon WHERE habitat_id = ?')
    .get(id)
  ro.close()

  assert.strictEqual(row.pokemon_name, 'Bulbasaur')
  assert.strictEqual(row.rarity, 'Common')
  assert.strictEqual(row.locations, 'Withered Wastelands|Bleak Beach')
  assert.strictEqual(row.times, 'Morning|Day')
  assert.strictEqual(row.weathers, 'Sun|Rain')
})

test('INSERT OR IGNORE idempotence for recipe/pokemon', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  createTables(dbPath)

  const id = addHabitatToDb(dbPath, 1, 'Tall Grass', 'tallgrass', 'img', 'desc', 'main')

  const recipe = [{ name: 'Lumber', quantity: 2 }]
  const pokemon = [
    {
      name: 'Pikachu',
      rarity: 'Common',
      locations: ['Palette Town'],
      times: ['Day'],
      weathers: ['Sun'],
    },
  ]

  // Insert twice — should not duplicate
  addHabitatRecipe(dbPath, id, recipe)
  addHabitatRecipe(dbPath, id, recipe)
  addHabitatPokemon(dbPath, id, pokemon)
  addHabitatPokemon(dbPath, id, pokemon)

  const ro = new DatabaseSync(dbPath, { readOnly: true })
  const recipeCount = ro.prepare('SELECT COUNT(*) AS cnt FROM habitat_recipe WHERE habitat_id = ?').get(id)
  const pokeCount = ro.prepare('SELECT COUNT(*) AS cnt FROM habitat_pokemon WHERE habitat_id = ?').get(id)
  ro.close()

  assert.strictEqual(recipeCount.cnt, 1)
  assert.strictEqual(pokeCount.cnt, 1)
})

test('FK ordering: recipe/pokemon fail on nonexistent habitat_id', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  // Seeding from db.sql to have proper schema + PRAGMA
  seedTestDb(dbPath)

  // habitat_id 9999 doesn't exist — FK violation should throw
  assert.throws(() => {
    addHabitatRecipe(dbPath, 9999, [{ name: 'Lumber', quantity: 1 }])
  })

  assert.throws(() => {
    addHabitatPokemon(dbPath, 9999, [
      { name: 'Pikachu', rarity: 'Common', locations: [], times: [], weathers: [] },
    ])
  })
})

test('getExistingHabitats and findMissingHabitats', (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  createTables(dbPath)

  addHabitatToDb(dbPath, 1, 'Tall Grass', 'tallgrass', 'img', 'desc', 'main')

  const { namesLower, slugSet } = getExistingHabitats(dbPath)
  assert.ok(namesLower.has('tall grass'))
  assert.ok(slugSet.has('tallgrass'))

  const allEntries = [
    { number: 1, name: 'Tall Grass', slug: 'tallgrass', thumbnailBasename: '1', description: 'd', category: 'main' },
    { number: 2, name: 'Tree-shaded tall grass', slug: 'treeshadedtallgrass', thumbnailBasename: '2', description: 'd', category: 'main' },
  ]
  const missing = findMissingHabitats(allEntries, namesLower)
  assert.strictEqual(missing.length, 1)
  assert.strictEqual(missing[0].name, 'Tree-shaded tall grass')
})

// ---------------------------------------------------------------------------
// Orchestration: dry-run with stubbed fetch
// ---------------------------------------------------------------------------

function habitatsFetchMap() {
  return (url) => {
    if (url.includes('habitats.shtml')) {
      return LIST_HTML
    }
    if (url.includes('tallgrass.shtml')) {
      return DETAIL_HTML
    }
    if (url.includes('basintallgrass.shtml')) {
      return BASIN_DETAIL_HTML
    }
    if (url.includes('yellowcarpet.shtml')) {
      return BASIN_DETAIL_HTML.replace('b1', 'e1').replace('Basin tall grass', 'Yellow carpet')
    }
    if (url.includes('treeshadedtallgrass.shtml')) {
      return DETAIL_HTML.replace('/habitatdex/1.png', '/habitatdex/2.png')
        .replace('<h1>Tall Grass</h1>', '<h1>Tree-shaded tall grass</h1>')
    }
    return ''
  }
}

test('main --dry-run with stubbed fetch does not write to DB', async (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  const imagesDir = path.join(tmp, 'images', 'habitats')
  createTables(dbPath)

  stubFetch(t, habitatsFetchMap())

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
  assert.match(output, /Tall Grass/)

  // DB should have no habitats (only the table was created)
  const ro = new DatabaseSync(dbPath, { readOnly: true })
  const row = ro.prepare('SELECT COUNT(*) AS cnt FROM serebii_habitats').get()
  ro.close()
  assert.strictEqual(row.cnt, 0)

  // No images downloaded
  assert.ok(!fs.existsSync(path.join(imagesDir, '1.png')))
})

test('main --verify with stubbed fetch prints verification report', async (t) => {
  const tmp = makeTempDir()
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dbPath = dbPathFor(tmp)
  const imagesDir = path.join(tmp, 'images', 'habitats')
  // Seed from db.sql so the pokemon table (used for name-drift check) exists.
  seedTestDb(dbPath)

  // Pre-seed one habitat so verify has something to compare against
  addHabitatToDb(dbPath, 1, 'Tall Grass', 'tallgrass', 'images/habitats/1.png', 'desc', 'main')

  stubFetch(t, habitatsFetchMap())

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
  assert.match(output, /Serebii habitats:/)
  assert.match(output, /DB habitats:/)
})
