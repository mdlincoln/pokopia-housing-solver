// Harvest Pokopia habitat data from Serebii's habitat list and detail pages into
// the local SQLite DB. Stdlib-only (node:fs, node:path, node:sqlite, fetch).
//
// Scrapes Serebii's habitats list page to discover all habitats (Main, Basin,
// Event sections), then fetches each habitat's detail page to extract the
// sprite image, flavor text, building requirements (item + quantity), and
// available pokemon spawns (with rarity, locations, times, weathers).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import {
  DEFAULT_DB_PATH,
  DEFAULT_IMAGES_DIR,
  IMAGE_BASE,
  USER_AGENT,
  fetchPage,
  jitteredDelay,
  openReadOnlyDb,
  openWritableDb,
  stripTags,
  unescapeHtml,
} from './harvest_lib.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIST_URL = 'https://www.serebii.net/pokemonpokopia/habitats.shtml'
const DETAIL_URL_TMPL = 'https://www.serebii.net/pokemonpokopia/habitatdex/{}.shtml'
const DEFAULT_HABITAT_IMAGES_DIR = path.join(DEFAULT_IMAGES_DIR, 'habitats')

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url))
const DB_SQL_PATH = path.join(SCRIPTS_DIR, 'db.sql')

// ---------------------------------------------------------------------------
// Regexes
// ---------------------------------------------------------------------------

// List page: section divider — <td class="fooevo" colspan="4">...Habitats (Basin)</td>
const SECTION_DIVIDER_RE = /Habitats\s*\((Basin|Event)\)/i

// List page: habitat row contents.
// Number: <td class="cen">#001</td>
const LIST_NUMBER_RE = /<td class="cen">#(\d+)<\/td>/i

// Thumbnail link: <a href="habitatdex/<slug>.shtml"><img src="habitatdex/th/<basename>.png" ...>
const LIST_THUMB_RE =
  /<a href="habitatdex\/([^"]+)\.shtml"><img src="habitatdex\/th\/([^"]+)\.png"/i

// Name link: <a href="habitatdex/<slug>.shtml"><u>Name</u></a>
const LIST_NAME_RE = /<a href="habitatdex\/[^"]+\.shtml"><u>([^<]+)<\/u><\/a>/i

// Detail page: habitat name from <h1>
const DETAIL_NAME_RE = /<h1>([^<]+)<\/h1>/i

// Detail page: full-size habitat image — /pokemonpokopia/habitatdex/<basename>.png
// (thumbnail images use /habitatdex/th/N.png which won't match — "th/" blocks [a-z]?\d+).
const DETAIL_IMG_RE = /<img src="(\/pokemonpokopia\/habitatdex\/([a-z]?\d+)\.png)"/i

// Detail page: flavor text — between <h2>Flavor Text</h2> and next section.
const FLAVOR_TEXT_RE = /Flavor Text<\/h2>[\s\S]*?<td class="fooinfo"[^>]*>\s*([\s\S]*?)\s*<\/td>/i

// Detail page: Requirements section — from <h2>Requirements</h2> to next <h2>.
const REQ_SECTION_RE = /<h2>Requirements<\/h2>[\s\S]*?(?=<h2|<\/body>|$)/i

// Recipe row: item name link followed by quantity cell.
const RECIPE_ITEM_RE =
  /<a href="\/pokemonpokopia\/items\/[^"]+\.shtml"><u>([^<]+)<\/u><\/a>\s*<\/td>\s*<td class="fooinfo">(\d+)/gi

// Detail page: Available Pokémon section — from "Available Pok" to end of page.
const AVAIL_SECTION_RE = /Available Pok[\s\S]*$/i

// Pokemon name in a fooevo cell (batch names row).
const POKEMON_NAME_RE =
  /<td class="fooevo"><a href="\/pokemonpokopia\/pokedex\/[^"]+\.shtml">([^<]+)<\/a><\/td>/gi

// ---------------------------------------------------------------------------
// Pure parsers (operate on an already-fetched HTML string; exported for tests)
// ---------------------------------------------------------------------------

/**
 * Parse the habitats list page HTML.
 * Returns an array of { number, name, slug, thumbnailBasename, description, category }.
 * Category starts as 'main' and switches to 'basin'/'event' at section dividers.
 */
export function parseHabitatListHtml(html) {
  const entries = []
  let category = 'main'

  // Split by <tr> rows
  const rows = html.split(/<tr[^>]*>/i)
  for (const row of rows) {
    // Check for section divider
    const divMatch = SECTION_DIVIDER_RE.exec(row)
    if (divMatch) {
      category = divMatch[1].toLowerCase()
      continue
    }

    // Check for habitat entry (must have a number cell)
    const numMatch = LIST_NUMBER_RE.exec(row)
    if (!numMatch) {
      continue
    }

    const number = Number.parseInt(numMatch[1], 10)
    const thumbMatch = LIST_THUMB_RE.exec(row)
    const nameMatch = LIST_NAME_RE.exec(row)

    if (!thumbMatch || !nameMatch) {
      continue
    }

    const slug = thumbMatch[1]
    const thumbnailBasename = thumbMatch[2]
    const name = unescapeHtml(nameMatch[1]).trim()

    // Description is in the last <td class="fooinfo"> that's not a link cell.
    // Extract from the row, after the name link.
    let description = null
    const afterName = row.slice(row.indexOf(nameMatch[0]) + nameMatch[0].length)
    const descMatch = /<td class="fooinfo">([\s\S]*?)<\/td>/i.exec(afterName)
    if (descMatch) {
      description = stripTags(unescapeHtml(descMatch[1])).trim()
      if (!description) {
        description = null
      }
    }

    entries.push({ number, name, slug, thumbnailBasename, description, category })
  }

  return entries
}

/**
 * Parse a habitat detail page HTML.
 * Returns { name, imageUrl, imageNumber, flavorText, recipe, pokemon } or null
 * on incomplete extraction (missing image or flavor text).
 */
export function parseHabitatDetailHtml(html, slug) {
  // --- Name ---
  let name = slug
  const nameMatch = DETAIL_NAME_RE.exec(html)
  if (nameMatch) {
    name = unescapeHtml(nameMatch[1]).trim()
  }

  // --- Image ---
  const imgMatch = DETAIL_IMG_RE.exec(html)
  if (!imgMatch) {
    console.log(`  WARNING: no habitat image found for '${slug}'`)
    return null
  }
  const imageUrl = imgMatch[1]
  const imageNumber = imgMatch[2]

  // --- Flavor Text ---
  let flavorText = null
  const ftMatch = FLAVOR_TEXT_RE.exec(html)
  if (ftMatch) {
    flavorText = stripTags(unescapeHtml(ftMatch[1])).trim()
    if (!flavorText) {
      flavorText = null
    }
  }
  if (flavorText === null) {
    console.log(`  WARNING: no flavor text found for '${slug}'`)
    return null
  }

  // --- Recipe (Requirements) ---
  const recipe = []
  const reqMatch = REQ_SECTION_RE.exec(html)
  if (reqMatch) {
    const reqSection = reqMatch[0]
    for (const m of reqSection.matchAll(RECIPE_ITEM_RE)) {
      const itemName = unescapeHtml(m[1]).trim()
      const quantity = Number.parseInt(m[2], 10)
      recipe.push({ name: itemName, quantity })
    }
  }

  // --- Available Pokémon ---
  const pokemon = []
  const availMatch = AVAIL_SECTION_RE.exec(html)
  if (availMatch) {
    const availHtml = availMatch[0]

    // Split into batches: each batch starts at a names row (fooevo + pokedex link).
    const batchStartRe = /<tr>\s*<td class="fooevo"><a href="\/pokemonpokopia\/pokedex\//g
    const batchStarts = [...availHtml.matchAll(batchStartRe)].map((m) => m.index)

    for (let bi = 0; bi < batchStarts.length; bi++) {
      const start = batchStarts[bi]
      const end = bi + 1 < batchStarts.length ? batchStarts[bi + 1] : availHtml.length
      const batchHtml = availHtml.slice(start, end)

      pokemon.push(...parsePokemonBatch(batchHtml))
    }
  }

  return {
    name,
    imageUrl,
    imageNumber,
    flavorText,
    recipe,
    pokemon,
  }
}

/**
 * Parse a single batch of pokemon data from the Available Pokémon table.
 * Each batch is a 5-row group: names, images, locations, rarity, time/weather.
 */
function parsePokemonBatch(batchHtml) {
  // 1. Names
  const nameMatches = [...batchHtml.matchAll(POKEMON_NAME_RE)]
  const names = nameMatches.map((m) => unescapeHtml(m[1]).trim())
  if (names.length === 0) {
    return []
  }

  // Split all fooinfo cells (matching any attribute combination).
  // This preserves column alignment even when a cell is missing data —
  // an empty cell still produces a segment in the split.
  const fooinfoCells = batchHtml.split(/<td class="fooinfo"\s*/i).slice(1)

  // 2. Locations — cells containing the Location marker
  const locCells = fooinfoCells.filter((c) => /<b>Location<\/b>/i.test(c))
  const locationsPerPokemon = locCells.map((cell) => {
    const after = cell.split(/<b>Location<\/b>:/i)[1] || ''
    return [...after.matchAll(/<u>([^<]+)<\/u>/g)].map((m) => unescapeHtml(m[1]).trim())
  })

  // 3. Rarity — cells containing the Rarity marker
  const rarCells = fooinfoCells.filter((c) => /<b>Rarity<\/b>/i.test(c))
  const rarityPerPokemon = rarCells.map((cell) => {
    const after = cell.split(/<b>Rarity<\/b>:/i)[1] || ''
    const text = after.split(/<\/td>/i)[0]
    const rarity = stripTags(unescapeHtml(text)).trim()
    return rarity || null
  })

  // 4. Time/Weather — remaining fooinfo cells (not Location, not Rarity)
  // These include cells with nested tables (data) and empty cells (no data).
  const twCells = fooinfoCells.filter(
    (c) => !/<b>Rarity<\/b>/i.test(c) && !/<b>Location<\/b>/i.test(c),
  )
  const twPerPokemon = twCells.map((cell) => {
    const valCells = [...cell.matchAll(/<td valign="top">([\s\S]*?)<\/td>/g)].map((m) => m[1])

    const times = valCells[0]
      ? valCells[0]
          .split(/<br\s*\/?>/i)
          .map((v) => stripTags(unescapeHtml(v)).trim())
          .filter(Boolean)
      : []

    const weathers = valCells[1]
      ? valCells[1]
          .split(/<br\s*\/?>/i)
          .map((v) => stripTags(unescapeHtml(v)).trim())
          .filter(Boolean)
      : []

    return { times, weathers }
  })

  // Pad arrays to match names length
  const pad = (arr, defaultVal) => {
    while (arr.length < names.length) arr.push(defaultVal)
    return arr.slice(0, names.length)
  }

  const paddedLocs = pad(locationsPerPokemon, [])
  const paddedRars = pad(rarityPerPokemon, null)
  const paddedTw = pad(twPerPokemon, { times: [], weathers: [] })

  // Pair by column index
  return names.map((pokeName, i) => ({
    name: pokeName,
    rarity: paddedRars[i] ?? null,
    locations: paddedLocs[i] ?? [],
    times: paddedTw[i]?.times ?? [],
    weathers: paddedTw[i]?.weathers ?? [],
  }))
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

export function getExistingHabitats(dbPath) {
  const db = openReadOnlyDb(dbPath)
  try {
    const rows = db.prepare('SELECT id, name, detail_slug FROM habitat_entries').all()
    const namesLower = new Set()
    const slugSet = new Set()
    for (const { name, detail_slug } of rows) {
      namesLower.add(name.toLowerCase())
      if (detail_slug) {
        slugSet.add(detail_slug)
      }
    }
    return { namesLower, slugSet }
  } catch {
    // Table doesn't exist yet
    return { namesLower: new Set(), slugSet: new Set() }
  } finally {
    db.close()
  }
}

export function findMissingHabitats(allEntries, existingNamesLower) {
  return allEntries.filter((entry) => !existingNamesLower.has(entry.name.toLowerCase()))
}

/**
 * Create the habitat tables if they don't already exist.
 * Reads CREATE TABLE statements from scripts/db.sql.
 */
export function createTables(dbPath) {
  const schemaSql = fs.readFileSync(DB_SQL_PATH, 'utf8')
  const tableNames = [
    'habitat_entries',
    'habitat_recipe',
    'habitat_pokemon',
    // Join tables must be created after habitat_pokemon: their composite
    // foreign keys reference habitat_pokemon (habitat_id, pokemon_name).
    'habitat_pokemon_location',
    'habitat_pokemon_time',
    'habitat_pokemon_weather',
  ]

  const statements = []
  for (const tableName of tableNames) {
    const re = new RegExp(`CREATE\\s+TABLE\\s+${tableName}\\s+\\([\\s\\S]*?\\);`, 'i')
    const match = re.exec(schemaSql)
    if (match) {
      // Ensure IF NOT EXISTS for idempotent creation
      statements.push(match[0].replace(/CREATE\s+TABLE/i, 'CREATE TABLE IF NOT EXISTS'))
    } else {
      throw new Error(`Could not find CREATE TABLE for ${tableName} in db.sql`)
    }
  }

  const db = openWritableDb(dbPath)
  try {
    for (const stmt of statements) {
      db.exec(stmt)
    }
  } finally {
    db.close()
  }
}

export function addHabitatToDb(dbPath, number, name, slug, imagePath, description, category) {
  const db = openWritableDb(dbPath)
  try {
    const result = db
      .prepare(
        'INSERT INTO habitat_entries (number, name, detail_slug, image_path, description, category) ' +
          'VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(number, name, slug, imagePath, description, category)
    return result.lastInsertRowid
  } finally {
    db.close()
  }
}

export function addHabitatRecipe(dbPath, habitatId, recipe) {
  const db = openWritableDb(dbPath)
  try {
    const insert = db.prepare(
      'INSERT OR IGNORE INTO habitat_recipe (habitat_id, item_name, quantity) VALUES (?, ?, ?)',
    )
    for (const { name, quantity } of recipe) {
      insert.run(habitatId, name, quantity)
    }
  } finally {
    db.close()
  }
}

export function addHabitatPokemon(dbPath, habitatId, pokemon) {
  const db = openWritableDb(dbPath)
  try {
    // Base row first (parent), then one row per value in each join table.
    // All INSERT OR IGNORE keeps re-runs idempotent; the composite FKs on the
    // join tables require the parent row to exist before join inserts.
    const insertBase = db.prepare(
      'INSERT OR IGNORE INTO habitat_pokemon (habitat_id, pokemon_name, rarity) VALUES (?, ?, ?)',
    )
    const insertLocation = db.prepare(
      'INSERT OR IGNORE INTO habitat_pokemon_location (habitat_id, pokemon_name, location) VALUES (?, ?, ?)',
    )
    const insertTime = db.prepare(
      'INSERT OR IGNORE INTO habitat_pokemon_time (habitat_id, pokemon_name, time) VALUES (?, ?, ?)',
    )
    const insertWeather = db.prepare(
      'INSERT OR IGNORE INTO habitat_pokemon_weather (habitat_id, pokemon_name, weather) VALUES (?, ?, ?)',
    )
    for (const p of pokemon) {
      insertBase.run(habitatId, p.name, p.rarity ?? null)
      for (const location of p.locations) {
        insertLocation.run(habitatId, p.name, location)
      }
      for (const time of p.times) {
        insertTime.run(habitatId, p.name, time)
      }
      for (const weather of p.weathers) {
        insertWeather.run(habitatId, p.name, weather)
      }
    }
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Image download
// ---------------------------------------------------------------------------

async function downloadHabitatImage(imageUrl, basename, imagesDir, baseDelay) {
  const destPath = path.join(imagesDir, `${basename}.png`)
  const dbImagePath = `images/habitats/${basename}.png`

  if (fs.existsSync(destPath)) {
    console.log(`    Image already present: ${dbImagePath} (skip)`)
    return dbImagePath
  }

  const fullUrl = imageUrl.startsWith('http') ? imageUrl : IMAGE_BASE + imageUrl
  const res = await fetch(fullUrl, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching image ${fullUrl}`)
  }
  const imageBytes = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(destPath, imageBytes)
  console.log(`    Downloaded image: ${destPath} (${imageBytes.length} bytes)`)
  await jitteredDelay(baseDelay)
  return dbImagePath
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function scrapeHabitatList(baseDelay) {
  console.log(`Fetching habitat list: ${LIST_URL}`)
  const pageHtml = await fetchPage(LIST_URL)
  const entries = parseHabitatListHtml(pageHtml)
  await jitteredDelay(baseDelay)
  console.log(`Discovered ${entries.length} habitats on Serebii.`)
  return entries
}

export async function scrapeHabitatDetail(slug, baseDelay) {
  const url = DETAIL_URL_TMPL.replace('{}', slug)
  let pageHtml
  try {
    pageHtml = await fetchPage(url)
  } catch (e) {
    console.log(`  ERROR fetching detail page for '${slug}': ${e.message}`)
    return null
  }
  const detail = parseHabitatDetailHtml(pageHtml, slug)
  if (detail !== null) {
    await jitteredDelay(baseDelay)
  }
  return detail
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

export async function backfillHabitats(dbPath, imagesDir, baseDelay) {
  const ro = openReadOnlyDb(dbPath)
  let incomplete
  try {
    incomplete = ro
      .prepare(
        'SELECT id, name, detail_slug, image_path, number, category FROM habitat_entries h ' +
          'WHERE (' +
          '  (SELECT COUNT(*) FROM habitat_recipe WHERE habitat_id = h.id) = 0' +
          '  AND (SELECT COUNT(*) FROM habitat_pokemon WHERE habitat_id = h.id) = 0' +
          ')',
      )
      .all()
  } finally {
    ro.close()
  }

  if (incomplete.length === 0) {
    console.log('\n--- Backfill: all habitats have recipe/pokemon data (or none needed) ---')
    return
  }

  console.log(`\n--- Backfilling ${incomplete.length} habitats with missing data ---`)

  let backfilled = 0
  let skipped = 0
  for (const { id, name, detail_slug } of incomplete) {
    if (!detail_slug) {
      console.log(`  SKIP '${name}': no detail_slug`)
      skipped += 1
      continue
    }

    const detail = await scrapeHabitatDetail(detail_slug, baseDelay)
    if (detail === null) {
      console.log(`  SKIP '${name}': detail extraction failed`)
      skipped += 1
      continue
    }

    // Re-download image if missing
    if (detail.imageNumber) {
      fs.mkdirSync(imagesDir, { recursive: true })
      const imgPath = path.join(imagesDir, `${detail.imageNumber}.png`)
      if (!fs.existsSync(imgPath)) {
        try {
          await downloadHabitatImage(detail.imageUrl, detail.imageNumber, imagesDir, baseDelay)
        } catch (e) {
          console.log(`  WARNING: image download failed for '${name}': ${e.message}`)
        }
      }
    }

    if (detail.recipe.length > 0) {
      addHabitatRecipe(dbPath, id, detail.recipe)
    }
    if (detail.pokemon.length > 0) {
      addHabitatPokemon(dbPath, id, detail.pokemon)
    }

    console.log(
      `  Backfilled '${name}' (${detail.recipe.length} recipe items, ${detail.pokemon.length} pokemon)`,
    )
    backfilled += 1
  }

  console.log(`Backfill: ${backfilled} updated, ${skipped} skipped.`)
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export function verifyHabitats(dbPath, allEntries, imagesDir) {
  const db = openReadOnlyDb(dbPath)
  let dbHabitats
  let dbPokemon
  let dbPokemonNames
  try {
    dbHabitats = db.prepare('SELECT * FROM habitat_entries').all()
    dbPokemon = db.prepare('SELECT * FROM habitat_pokemon').all()
    dbPokemonNames = new Set(
      db
        .prepare('SELECT name FROM pokemon')
        .all()
        .map((r) => r.name.toLowerCase()),
    )
  } finally {
    db.close()
  }

  const dbByName = new Map(dbHabitats.map((r) => [r.name.toLowerCase(), r]))
  const serebiiNamesLower = new Set(allEntries.map((e) => e.name.toLowerCase()))

  console.log('\n' + '='.repeat(60))
  console.log('VERIFICATION REPORT')
  console.log('='.repeat(60))
  console.log(`Serebii habitats: ${allEntries.length}`)
  console.log(`DB habitats:      ${dbHabitats.length}`)

  // Missing / extra
  const missing = [...serebiiNamesLower].filter((n) => !dbByName.has(n))
  const extra = [...dbByName.keys()].filter((n) => !serebiiNamesLower.has(n))

  if (missing.length > 0) {
    console.log(`\nMISSING from DB (${missing.length}):`)
    for (const name of missing.sort()) {
      console.log(`  - ${name}`)
    }
  } else {
    console.log('\nMissing from DB: none')
  }

  if (extra.length > 0) {
    console.log(`\nExtra in DB (not on Serebii, ${extra.length}):`)
    for (const name of extra.sort()) {
      console.log(`  + ${name}`)
    }
  } else {
    console.log('Extra in DB: none')
  }

  // Check image files — image_path is relative to the project's images dir
  // (e.g. "images/habitats/1.png"), but imagesDir may be the habitats subdir.
  // Resolve from the project root's public/images/ regardless.
  const baseImagesDir = path.dirname(imagesDir)
  let missingImages = 0
  for (const { name, image_path } of dbHabitats) {
    if (image_path) {
      const localFile = path.join(baseImagesDir, image_path.replace(/^images\//, ''))
      if (!fs.existsSync(localFile)) {
        console.log(`  ! Missing image file for '${name}': ${localFile}`)
        missingImages += 1
      }
    }
  }

  // Pokemon name drift check
  let nameDrift = 0
  for (const { pokemon_name } of dbPokemon) {
    if (!dbPokemonNames.has(pokemon_name.toLowerCase())) {
      console.log(`  WARNING: pokemon '${pokemon_name}' in habitat_pokemon not in pokemon table`)
      nameDrift += 1
    }
  }

  const violations = missing.length + extra.length + missingImages

  if (violations === 0) {
    console.log('\nIntegrity: OK (no violations)')
  } else {
    console.log(`\nIntegrity: ${violations} issue(s) found`)
  }

  if (nameDrift > 0) {
    console.log(`Name drift: ${nameDrift} pokemon name(s) not in pokemon table (informational)`)
  }

  const ok = violations === 0
  console.log('='.repeat(60))
  console.log(`Result: ${ok ? 'PASS' : 'FAIL'}`)
  console.log('='.repeat(60))
  return ok
}

// ---------------------------------------------------------------------------
// CLI / main
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/harvest_habitats.js [options]

Harvest Pokopia habitat data from Serebii's habitat database.

Options:
  --dry-run          Scrape and report what would be added, but do not write.
  --verify           Skip harvesting; run the completeness + integrity check only.
  --db <path>        Path to the SQLite DB (default: ${DEFAULT_DB_PATH})
  --images-dir <dir> Directory for habitat images (default: ${DEFAULT_HABITAT_IMAGES_DIR})
  --delay <seconds>  Base request delay in seconds; actual delay is jittered to [delay, 3.0].
  -h, --help         Show this help message and exit.
`

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
        'images-dir': { type: 'string', default: DEFAULT_HABITAT_IMAGES_DIR },
        delay: { type: 'string', default: '0.5' },
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
  const imagesDir = path.resolve(values['images-dir'])
  const baseDelay = Number.parseFloat(values.delay)
  if (Number.isNaN(baseDelay)) {
    console.error(`Invalid --delay value: '${values.delay}'`)
    console.log(USAGE)
    process.exit(2)
  }

  // --- Verify-only mode ---
  if (values.verify) {
    console.log('Running in verify-only mode.\n')
    const allEntries = await scrapeHabitatList(baseDelay)

    // Fetch all detail pages and compare against DB
    const db = openReadOnlyDb(dbPath)
    let dbHabitats
    try {
      dbHabitats = db.prepare('SELECT * FROM habitat_entries').all()
    } catch {
      dbHabitats = []
    } finally {
      db.close()
    }

    const dbByName = new Map(dbHabitats.map((r) => [r.name.toLowerCase(), r]))
    let mismatches = 0

    console.log(`\nVerifying ${allEntries.length} habitats against DB...`)
    for (const [i, entry] of allEntries.entries()) {
      const dbRow = dbByName.get(entry.name.toLowerCase())
      if (!dbRow) {
        console.log(`  [${i + 1}/${allEntries.length}] MISSING: ${entry.name}`)
        mismatches += 1
        continue
      }

      // Fetch detail for deeper comparison
      const detail = await scrapeHabitatDetail(entry.slug, baseDelay)
      if (detail === null) {
        console.log(`  [${i + 1}/${allEntries.length}] PARSE ERROR: ${entry.name}`)
        mismatches += 1
        continue
      }

      // Check recipe
      const dbRecipeRows = openReadOnlyDb(dbPath)
        .prepare('SELECT item_name, quantity FROM habitat_recipe WHERE habitat_id = ?')
        .all(dbRow.id)
      const dbRecipeMap = new Map(dbRecipeRows.map((r) => [r.item_name.toLowerCase(), r.quantity]))

      for (const { name, quantity } of detail.recipe) {
        const dbQty = dbRecipeMap.get(name.toLowerCase())
        if (dbQty === undefined) {
          console.log(
            `  [${i + 1}/${allEntries.length}] MISSING RECIPE ITEM: ${entry.name} / ${name}`,
          )
          mismatches += 1
        } else if (dbQty !== quantity) {
          console.log(
            `  [${i + 1}/${allEntries.length}] MISMATCHED QUANTITY: ${entry.name} / ${name}: ${dbQty} vs ${quantity}`,
          )
          mismatches += 1
        }
      }

      // Check pokemon
      const dbPokeRows = openReadOnlyDb(dbPath)
        .prepare('SELECT * FROM habitat_pokemon WHERE habitat_id = ?')
        .all(dbRow.id)
      const dbPokeMap = new Map(dbPokeRows.map((r) => [r.pokemon_name.toLowerCase(), r]))

      for (const p of detail.pokemon) {
        const dbPoke = dbPokeMap.get(p.name.toLowerCase())
        if (!dbPoke) {
          console.log(
            `  [${i + 1}/${allEntries.length}] MISSING POKEMON: ${entry.name} / ${p.name}`,
          )
          mismatches += 1
        }
      }

      if ((i + 1) % 20 === 0) {
        console.log(`  [${i + 1}/${allEntries.length}] checked...`)
      }
    }

    verifyHabitats(dbPath, allEntries, imagesDir)
    if (mismatches > 0) {
      console.log(`\nDetailed mismatches: ${mismatches}`)
    }
    return
  }

  // --- Harvest mode ---
  const allEntries = await scrapeHabitatList(baseDelay)

  createTables(dbPath)

  const { namesLower: existingNamesLower } = getExistingHabitats(dbPath)
  const missing = findMissingHabitats(allEntries, existingNamesLower)
  const existingCount = allEntries.length - missing.length

  console.log(
    `\nFound ${allEntries.length} habitats on Serebii, ` +
      `${existingCount} already in DB, ${missing.length} to add.`,
  )

  if (missing.length === 0 && !values['dry-run']) {
    console.log('Nothing to add. Running backfill + verification...')
    await backfillHabitats(dbPath, imagesDir, baseDelay)
    verifyHabitats(dbPath, allEntries, imagesDir)
    return
  }

  if (missing.length === 0 && values['dry-run']) {
    console.log('[DRY RUN] No missing habitats found.')
    return
  }

  // --- Dry run ---
  if (values['dry-run']) {
    console.log(`\n[DRY RUN] Would add ${missing.length} habitats:\n`)
    for (const [i, entry] of missing.entries()) {
      try {
        const detail = await scrapeHabitatDetail(entry.slug, baseDelay)
        if (detail === null) {
          console.log(
            `  [${i + 1}/${missing.length}] DRY RUN: would add ${entry.name} ` +
              `(EXTRACTION FAILED — see warnings above)`,
          )
          continue
        }
        console.log(
          `  [${i + 1}/${missing.length}] DRY RUN: would add ${detail.name}\n` +
            `    number=#${String(entry.number).padStart(3, '0')}\n` +
            `    category=${entry.category}\n` +
            `    image=${detail.imageNumber}.png\n` +
            `    flavor_text=${detail.flavorText}\n` +
            `    recipe=${JSON.stringify(detail.recipe)}\n` +
            `    pokemon=${JSON.stringify(detail.pokemon.map((p) => p.name))}`,
        )
      } catch (e) {
        console.log(`  [${i + 1}/${missing.length}] ERROR scraping '${entry.name}': ${e.message}`)
      }
    }
    console.log('\n[DRY RUN complete — no writes performed.]')
    return
  }

  // --- Real harvest ---
  fs.mkdirSync(imagesDir, { recursive: true })

  console.log(`\nHarvesting ${missing.length} habitats...\n`)
  let added = 0
  let failed = 0

  for (const [i, entry] of missing.entries()) {
    try {
      const detail = await scrapeHabitatDetail(entry.slug, baseDelay)
      if (detail === null) {
        console.log(`  [${i + 1}/${missing.length}] SKIP '${entry.name}': extraction failed`)
        failed += 1
        continue
      }

      // Download image
      let imagePath = null
      if (detail.imageNumber) {
        try {
          imagePath = await downloadHabitatImage(
            detail.imageUrl,
            detail.imageNumber,
            imagesDir,
            baseDelay,
          )
        } catch (e) {
          console.log(`  WARNING: image download failed for '${entry.name}': ${e.message}`)
        }
      }

      // Insert habitat record
      const habitatId = addHabitatToDb(
        dbPath,
        entry.number,
        detail.name,
        entry.slug,
        imagePath,
        detail.flavorText,
        entry.category,
      )

      // Insert recipe
      if (detail.recipe.length > 0) {
        addHabitatRecipe(dbPath, habitatId, detail.recipe)
      }

      // Insert pokemon
      if (detail.pokemon.length > 0) {
        addHabitatPokemon(dbPath, habitatId, detail.pokemon)
      }

      console.log(
        `  [${i + 1}/${missing.length}] Added '${detail.name}' ` +
          `(#${String(entry.number).padStart(3, '0')}, ${entry.category}, ` +
          `${detail.recipe.length} recipe items, ${detail.pokemon.length} pokemon)`,
      )
      added += 1
    } catch (e) {
      console.log(`  [${i + 1}/${missing.length}] ERROR adding '${entry.name}': ${e.message}`)
      failed += 1
    }
  }

  // Backfill
  await backfillHabitats(dbPath, imagesDir, baseDelay)

  console.log(
    `\nHarvest complete: added=${added}, failed=${failed}, total on Serebii=${allEntries.length}`,
  )

  // Verify
  verifyHabitats(dbPath, allEntries, imagesDir)
}

// Run when this file is the entry point.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  await main()
}
