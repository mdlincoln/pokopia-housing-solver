// Harvest missing Pokemon from Serebii's Pokopia Pokedex into the local SQLite
// DB. Stdlib-only port of the former scripts/harvest_pokemon.py.
//
// Scrapes Serebii's Pokopia Pokedex list pages to discover all pokemon
// detail-page URLs and display names, compares case-insensitively against the
// existing ``src/pokehousing.sqlite`` database, then for each missing pokemon
// fetches its detail page to extract the sprite image URL, ideal habitat, and
// favorites. The sprite is downloaded to ``public/images/`` and the pokemon
// record + favorites are inserted into SQLite.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import {
  DEFAULT_DB_PATH,
  DEFAULT_IMAGES_DIR,
  downloadImage,
  fetchPage,
  jitteredDelay,
  openReadOnlyDb,
  openWritableDb,
  unescapeHtml,
} from './harvest_lib.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIST_PAGES = [
  'https://www.serebii.net/pokemonpokopia/availablepokemon.shtml',
  'https://www.serebii.net/pokemonpokopia/eventpokedex.shtml',
  'https://www.serebii.net/pokemonpokopia/basinpokedex.shtml',
]

const DETAIL_URL_TMPL = 'https://www.serebii.net/pokemonpokopia/pokedex/{}.shtml'

// Sub-paths to filter out (these are navigation links, not pokemon).
const SKIP_SLUG_PREFIXES = ['specialty', 'idealhabitat']

// ---------------------------------------------------------------------------
// Regexes
// ---------------------------------------------------------------------------

// Matches <a href="/pokemonpokopia/pokedex/<slug>.shtml"><u><Name></u></a>
const LIST_LINK_RE = /<a href="\/pokemonpokopia\/pokedex\/([^"]+)\.shtml"><u>([^<]+)<\/u><\/a>/g

// Two-step image extraction: find the <img> tag with id="sprite-regular", then
// pull out the src attribute. Handles either attribute order and XHTML/HTML.
const IMG_TAG_RE = /<img[^>]*id="sprite-regular"[^>]*>/i
const SRC_RE = /src="([^"]+)"/i

const HABITAT_RE = /idealhabitat\/([a-z]+)\.shtml"><u>([A-Za-z]+)<\/u>/i

const FAVORITE_RE = /href="\/pokemonpokopia\/favorites\/([^"]+)\.shtml"><u>([^<]+)<\/u><\/a>/g

// ---------------------------------------------------------------------------
// Pure parsers (exported for tests)
// ---------------------------------------------------------------------------

export function parsePokemonListHtml(html) {
  const seenSlugs = new Set()
  const entries = []
  for (const m of html.matchAll(LIST_LINK_RE)) {
    const slug = m[1]
    if (SKIP_SLUG_PREFIXES.some((p) => slug.startsWith(p))) {
      continue
    }
    if (seenSlugs.has(slug)) {
      continue
    }
    seenSlugs.add(slug)
    const name = unescapeHtml(m[2]).trim()
    entries.push({ slug, name })
  }
  return entries
}

/**
 * Parse a single pokemon detail page. Returns the full detail object, or
 * ``null`` on incomplete extraction (missing image_url or habitat).
 */
export function parsePokemonDetailHtml(html, slug) {
  // --- Image URL ---
  let imageUrl = null
  const imgTagMatch = IMG_TAG_RE.exec(html)
  if (imgTagMatch) {
    const srcMatch = SRC_RE.exec(imgTagMatch[0])
    if (srcMatch) {
      imageUrl = srcMatch[1]
    }
  }

  // --- Habitat ---
  let habitat = null
  const habMatch = HABITAT_RE.exec(html)
  if (habMatch) {
    habitat = habMatch[2] // the display text, e.g. "Bright"
  }

  // --- Favorites ---
  const favorites = []
  for (const m of html.matchAll(FAVORITE_RE)) {
    favorites.push(unescapeHtml(m[2]).trim())
  }

  const imageFilename = imageUrl ? imageUrl.split('/').at(-1) : null

  if (imageUrl === null || habitat === null) {
    console.log(
      `  WARNING: incomplete extraction for '${slug}': ` +
        `image_url=${imageUrl}, habitat=${habitat}, favorites=${JSON.stringify(favorites)}`,
    )
    return null
  }

  return {
    slug,
    name: slug, // placeholder; caller overwrites with list-page name
    imageUrl,
    imageFilename,
    habitat,
    favorites,
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function scrapePokemonList(baseDelay) {
  const seenSlugs = new Set()
  const entries = []
  for (const url of LIST_PAGES) {
    console.log(`Fetching list page: ${url}`)
    const pageHtml = await fetchPage(url)
    for (const entry of parsePokemonListHtml(pageHtml)) {
      if (seenSlugs.has(entry.slug)) {
        continue
      }
      seenSlugs.add(entry.slug)
      entries.push(entry)
    }
    await jitteredDelay(baseDelay)
  }
  console.log(`Discovered ${entries.length} unique pokemon across all list pages.`)
  return entries
}

export async function scrapePokemonDetail(slug, baseDelay) {
  const url = DETAIL_URL_TMPL.replace('{}', slug)
  const pageHtml = await fetchPage(url)
  const detail = parsePokemonDetailHtml(pageHtml, slug)
  if (detail !== null) {
    await jitteredDelay(baseDelay)
  }
  return detail
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/**
 * Case-insensitive habitat-name map for validating scraped habitat values, so
 * the insert path and the update path share one validation code path.
 */
function loadValidHabitatsLower(db) {
  const validHabitatRows = db.prepare('SELECT habitat FROM habitats').all()
  return new Map(validHabitatRows.map((r) => [r.habitat.toLowerCase(), r.habitat]))
}

export function getExistingPokemon(dbPath) {
  const db = openReadOnlyDb(dbPath)
  try {
    const rows = db.prepare('SELECT name FROM pokemon').all()
    const namesLower = new Set(rows.map((r) => r.name.toLowerCase()))
    const nameMap = new Map(rows.map((r) => [r.name.toLowerCase(), r.name]))

    const favRows = db.prepare('SELECT name FROM favorites').all()
    const favLower = new Set(favRows.map((r) => r.name.toLowerCase()))
    return { namesLower, nameMap, favLower }
  } finally {
    db.close()
  }
}

export function findMissingPokemon(allEntries, existingNamesLower) {
  return allEntries.filter((e) => !existingNamesLower.has(e.name.toLowerCase()))
}

export function addPokemonToDb(dbPath, name, imagePath, habitat, favorites, existingFavLower) {
  const db = openWritableDb(dbPath)
  const unmapped = new Set()
  try {
    // --- Habitat validation ---
    const validHabitatsLower = loadValidHabitatsLower(db)

    let habitatDb = habitat
    if (habitat && validHabitatsLower.has(habitat.toLowerCase())) {
      habitatDb = validHabitatsLower.get(habitat.toLowerCase())
    } else {
      console.log(`    WARNING: habitat '${habitat}' not in habitats table; inserting NULL`)
      habitatDb = null
    }

    // --- Insert pokemon ---
    const result = db
      .prepare('INSERT INTO pokemon (id, name, image_path, habitat) VALUES (NULL, ?, ?, ?)')
      .run(name, imagePath, habitatDb)
    const pokemonId = result.lastInsertRowid

    // --- Insert favorites ---
    const insert = db.prepare(
      'INSERT OR IGNORE INTO pokemon_favorites (pokemon_id, favorite_name) VALUES (?, ?)',
    )
    for (const fav of favorites) {
      const favLower = fav.toLowerCase()
      if (!existingFavLower.has(favLower)) {
        unmapped.add(fav)
        console.log(
          `    WARNING: favorite '${fav}' not in favorites table; ` +
            `skipping pokemon_favorites entry`,
        )
        continue
      }
      insert.run(pokemonId, favLower)
    }
  } finally {
    db.close()
  }
  return { pokemonId, unmapped }
}

// ---------------------------------------------------------------------------
// Update existing pokemon (opt-in --update-existing)
// ---------------------------------------------------------------------------

/**
 * Full-sync refresh of pre-existing pokemon rows against the Serebii detail
 * pages. For each scraped list entry whose lowercased name already exists in
 * the ``pokemon`` table:
 *   - UPDATE ``habitat`` only when it differs, validated case-insensitively
 *     against the ``habitats`` axis table (shared code path with the insert).
 *   - Image self-heal: re-download the sprite when the file on disk is missing
 *     (upstream 404s are logged and skipped, not fatal).
 *   - Full-sync ``pokemon_favorites``: insert missing favorites (validated
 *     against the favorites table, keeping the unmapped-favorite warning),
 *     delete rows not in the scraped set.
 *
 * ``name`` is never modified (legacy-hash contract), and a ``pokemon`` row
 * absent from the scraped listing is never deleted — top-level removals are
 * report-only in every domain.
 *
 * Null-parse skip rule: a fetch/parse failure skips the row entirely — no
 * habitat update, no favorites reconciliation, no deletes.
 *
 * With ``dryRun`` the planned delta is printed with zero DB/image writes.
 */
export async function updateExistingPokemon(
  dbPath,
  allEntries,
  imagesDir,
  baseDelay,
  existingFavLower,
  { dryRun = false } = {},
) {
  console.log(
    `\n--- Updating existing pokemon (full sync)${dryRun ? ' [DRY RUN — no writes]' : ''} ---`,
  )

  const ro = openReadOnlyDb(dbPath)
  let dbRows
  try {
    dbRows = ro
      .prepare('SELECT id, name, image_path, habitat FROM pokemon')
      .all()
      .map((r) => [r.name.toLowerCase(), r])
  } finally {
    ro.close()
  }
  const existingByLower = new Map(dbRows)

  let processed = 0
  let skipped = 0
  let habitatUpdates = 0
  let favInserted = 0
  let favDeleted = 0
  let imagesHealed = 0

  for (const [i, entry] of allEntries.entries()) {
    const tag = `[${i + 1}/${allEntries.length}]`
    const row = existingByLower.get(entry.name.toLowerCase())
    if (!row) {
      continue // new pokemon — handled by the insert pass
    }

    let detail
    try {
      detail = await scrapePokemonDetail(entry.slug, baseDelay)
    } catch (e) {
      console.log(
        `  ${tag} SKIP '${row.name}': fetch failed (${e.message}) — no updates, no deletes`,
      )
      skipped += 1
      continue
    }
    if (detail === null) {
      console.log(
        `  ${tag} SKIP '${row.name}': parse failed — no updates, no reconciliation, no deletes`,
      )
      skipped += 1
      continue
    }
    processed += 1
    const dry = dryRun ? 'DRY RUN: ' : ''

    // --- Habitat diff ---
    let habitatDb = detail.habitat
    if (habitatDb) {
      const db = openWritableDb(dbPath)
      let validHabitatsLower
      try {
        validHabitatsLower = loadValidHabitatsLower(db)
      } finally {
        db.close()
      }
      if (validHabitatsLower.has(habitatDb.toLowerCase())) {
        habitatDb = validHabitatsLower.get(habitatDb.toLowerCase())
      } else {
        console.log(
          `    WARNING: habitat '${habitatDb}' not in habitats table; storing NULL for '${row.name}'`,
        )
        habitatDb = null
      }
    } else {
      habitatDb = null
    }
    if ((row.habitat ?? null) !== (habitatDb ?? null)) {
      habitatUpdates += 1
      console.log(
        `  ${tag} ${dry}UPDATE '${row.name}' → habitat: ${JSON.stringify(row.habitat)} -> ` +
          `${JSON.stringify(habitatDb)}`,
      )
      if (!dryRun) {
        const db = openWritableDb(dbPath)
        try {
          db.prepare('UPDATE pokemon SET habitat = ? WHERE id = ?').run(habitatDb, row.id)
        } finally {
          db.close()
        }
      }
    }

    // --- Image self-heal ---
    if (row.image_path) {
      const localFile = path.join(imagesDir, row.image_path.replace(/^images\//, ''))
      if (!fs.existsSync(localFile) && detail.imageFilename) {
        imagesHealed += 1
        if (dryRun) {
          console.log(
            `  ${tag} DRY RUN: would re-download missing sprite for '${row.name}' (${row.image_path})`,
          )
        } else {
          try {
            const healed = await downloadImage(
              detail.imageUrl,
              detail.imageFilename,
              imagesDir,
              dbPath,
              { table: 'pokemon', column: 'image_path' },
              baseDelay,
            )
            console.log(`  ${tag} Image self-heal for '${row.name}': downloaded ${healed}`)
            if (healed !== row.image_path) {
              console.log(
                `    WARNING: healed image path ${healed} differs from DB image_path ` +
                  `${row.image_path} (DB value left unchanged)`,
              )
            }
          } catch (e) {
            console.log(
              `    WARNING: image self-heal failed for '${row.name}': ${e.message}. Skipping.`,
            )
          }
        }
      }
    }

    // --- pokemon_favorites full sync ---
    const expectedFavs = new Set(detail.favorites.map((f) => f.toLowerCase()))
    const db = openWritableDb(dbPath)
    let existingFavRows
    try {
      existingFavRows = db
        .prepare('SELECT favorite_name FROM pokemon_favorites WHERE pokemon_id = ?')
        .all(row.id)
    } finally {
      db.close()
    }

    for (const fav of expectedFavs) {
      const already = existingFavRows.some((r) => r.favorite_name.toLowerCase() === fav)
      if (already) {
        continue
      }
      if (!existingFavLower.has(fav)) {
        console.log(
          `  ${tag} favorite '${fav}' not in favorites table (no insert, row kept if present)`,
        )
        continue
      }
      favInserted += 1
      if (dryRun) {
        console.log(`  ${tag} DRY RUN: favorite INSERT '${fav}'`)
      } else {
        const wdb = openWritableDb(dbPath)
        try {
          wdb
            .prepare(
              'INSERT OR IGNORE INTO pokemon_favorites (pokemon_id, favorite_name) VALUES (?, ?)',
            )
            .run(row.id, fav)
        } finally {
          wdb.close()
        }
        console.log(`  ${tag} favorite INSERT '${fav}'`)
      }
    }
    for (const { favorite_name: favName } of existingFavRows) {
      if (!expectedFavs.has(favName.toLowerCase())) {
        favDeleted += 1
        if (dryRun) {
          console.log(
            `  ${tag} DRY RUN: favorite DELETE '${favName}' (not expected by the scraped page)`,
          )
        } else {
          const wdb = openWritableDb(dbPath)
          try {
            wdb
              .prepare('DELETE FROM pokemon_favorites WHERE pokemon_id = ? AND favorite_name = ?')
              .run(row.id, favName)
          } finally {
            wdb.close()
          }
          console.log(`  ${tag} favorite DELETE '${favName}' (absent from scraped favorites)`)
        }
      }
    }
  }

  console.log(
    `\nPokemon update pass: processed=${processed}, skipped=${skipped}, ` +
      `habitatUpdates=${habitatUpdates}, favorite inserts/deletes=${favInserted}/${favDeleted}, ` +
      `imagesHealed=${imagesHealed}`,
  )

  return { processed, skipped, habitatUpdates, favInserted, favDeleted, imagesHealed }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export function verifyCompleteness(dbPath, allEntries, imagesDir) {
  const db = openReadOnlyDb(dbPath)
  let dbNamesLower
  let validHabitats
  let validFavorites
  let allPokemon
  let pfRows
  let validPokemonIds
  try {
    dbNamesLower = new Set(
      db
        .prepare('SELECT name FROM pokemon')
        .all()
        .map((r) => r.name.toLowerCase()),
    )
    validHabitats = new Set(
      db
        .prepare('SELECT habitat FROM habitats')
        .all()
        .map((r) => r.habitat),
    )
    validFavorites = new Set(
      db
        .prepare('SELECT name FROM favorites')
        .all()
        .map((r) => r.name),
    )
    allPokemon = db.prepare('SELECT name, image_path, habitat FROM pokemon').all()
    pfRows = db.prepare('SELECT pokemon_id, favorite_name FROM pokemon_favorites').all()
    validPokemonIds = new Set(
      db
        .prepare('SELECT id FROM pokemon')
        .all()
        .map((r) => r.id),
    )
  } finally {
    db.close()
  }

  const serebiiNamesLower = new Set(allEntries.map((e) => e.name.toLowerCase()))
  const missing = new Set([...serebiiNamesLower].filter((n) => !dbNamesLower.has(n)))
  const extra = new Set([...dbNamesLower].filter((n) => !serebiiNamesLower.has(n)))

  console.log('\n' + '='.repeat(60))
  console.log('VERIFICATION REPORT')
  console.log('='.repeat(60))
  console.log(`Serebii unique pokemon: ${serebiiNamesLower.size}`)
  console.log(`DB pokemon count:      ${dbNamesLower.size}`)
  if (missing.size > 0) {
    console.log(`MISSING from DB (${missing.size}):`)
    for (const name of [...missing].sort()) {
      console.log(`  - ${name}`)
    }
  } else {
    console.log('Missing from DB: none')
  }
  if (extra.size > 0) {
    console.log(`Extra in DB (not on Serebii, ${extra.size}):`)
    for (const name of [...extra].sort()) {
      console.log(`  + ${name}`)
    }
  }

  const violations = []

  // 1. Every pokemon has non-null image_path
  for (const { name, image_path: imagePath } of allPokemon) {
    if (imagePath === null || imagePath === '') {
      violations.push(`pokemon '${name}' has null/empty image_path`)
    }
  }

  // 2. Non-null habitat must be valid.
  for (const { name, habitat } of allPokemon) {
    if (habitat !== null && !validHabitats.has(habitat)) {
      violations.push(`pokemon '${name}' has invalid habitat '${habitat}'`)
    }
  }

  // 3. Every pokemon_favorites entry has valid pokemon_id and favorite_name.
  for (const { pokemon_id: pid, favorite_name: favName } of pfRows) {
    if (!validPokemonIds.has(pid)) {
      violations.push(`pokemon_favorites orphan: pokemon_id=${pid} not in pokemon table`)
    }
    if (!validFavorites.has(favName)) {
      violations.push(
        `pokemon_favorites orphan (pokemon_id=${pid}): favorite_name '${favName}' not in favorites table`,
      )
    }
  }

  // 4. Every image_path file exists on disk.
  for (const { name, image_path: imagePath } of allPokemon) {
    if (imagePath) {
      const localFile = path.join(imagesDir, imagePath.replace(/^images\//, ''))
      if (!fs.existsSync(localFile)) {
        violations.push(`pokemon '${name}': image file missing on disk: ${localFile}`)
      }
    }
  }

  if (violations.length > 0) {
    console.log(`\nINTEGRITY VIOLATIONS (${violations.length}):`)
    for (const v of violations) {
      console.log(`  ! ${v}`)
    }
  } else {
    console.log('\nIntegrity: OK (no violations)')
  }

  const ok = missing.size === 0 && violations.length === 0
  console.log('='.repeat(60))
  console.log(`Result: ${ok ? 'PASS' : 'FAIL'}`)
  console.log('='.repeat(60))
  return ok
}

export function flagUnmappedFavorites(allSeenFavorites, dbFavoritesLower) {
  const unmapped = new Set()
  for (const fav of allSeenFavorites) {
    if (!dbFavoritesLower.has(fav.toLowerCase())) {
      unmapped.add(fav)
    }
  }

  console.log('\n--- Unmapped Favorites ---')
  if (unmapped.size > 0) {
    console.log(`${unmapped.size} Serebii favorite(s) have no match in DB:`)
    for (const fav of [...unmapped].sort()) {
      console.log(`  - ${fav}`)
    }
  } else {
    console.log('All Serebii favorites matched existing DB favorites.')
  }
  return unmapped
}

// ---------------------------------------------------------------------------
// CLI / main
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/harvest_pokemon.js [options]

Harvest missing Pokemon from Serebii's Pokopia Pokedex.

Options:
  --dry-run          Scrape and report what would be added, but do not write.
  --update-existing  Also refresh existing pokemon (habitat, sprite self-heal)
                     and full-sync their favorites (favorites absent from
                     Serebii are deleted; pokemon themselves are never deleted).
  --verify           Skip harvesting; run the completeness + integrity check only.
  --db <path>        Path to the SQLite DB (default: ${DEFAULT_DB_PATH})
  --images-dir <dir> Directory for sprite images (default: ${DEFAULT_IMAGES_DIR})
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
        'update-existing': { type: 'boolean', default: false },
        verify: { type: 'boolean', default: false },
        db: { type: 'string', default: DEFAULT_DB_PATH },
        'images-dir': { type: 'string', default: DEFAULT_IMAGES_DIR },
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
    const allEntries = await scrapePokemonList(baseDelay)
    const ok = verifyCompleteness(dbPath, allEntries, imagesDir)
    process.exitCode = ok ? 0 : 1
    return
  }

  // --- Harvest mode (dry-run or real) ---
  console.log('Fetching Serebii pokemon lists...')
  const allEntries = await scrapePokemonList(baseDelay)

  const { namesLower: existingNamesLower, favLower: existingFavLower } = getExistingPokemon(dbPath)

  const missing = findMissingPokemon(allEntries, existingNamesLower)
  const existingCount = allEntries.length - missing.length

  console.log(
    `\nFound ${allEntries.length} pokemon on Serebii, ` +
      `${existingCount} already in DB, ${missing.length} to add.`,
  )

  if (missing.length === 0) {
    if (values['update-existing']) {
      await updateExistingPokemon(dbPath, allEntries, imagesDir, baseDelay, existingFavLower, {
        dryRun: values['dry-run'],
      })
    }
    if (!values['dry-run']) {
      console.log('Nothing to add. Running verification...')
      const ok = verifyCompleteness(dbPath, allEntries, imagesDir)
      process.exitCode = ok ? 0 : 1
    }
    return
  }

  // --- Dry run ---
  if (values['dry-run']) {
    console.log(`\n[DRY RUN] Would add ${missing.length} pokemon:\n`)
    for (const [i, entry] of missing.entries()) {
      try {
        const detail = await scrapePokemonDetail(entry.slug, baseDelay)
        if (detail === null) {
          console.log(
            `  [${i + 1}/${missing.length}] DRY RUN: would add ${entry.name} ` +
              `(EXTRACTION FAILED — see warnings above)`,
          )
          continue
        }
        console.log(
          `  [${i + 1}/${missing.length}] DRY RUN: would add ${entry.name} ` +
            `(habitat=${detail.habitat}, image=${detail.imageUrl}, ` +
            `favorites=${JSON.stringify(detail.favorites)})`,
        )
      } catch (e) {
        console.log(`  [${i + 1}/${missing.length}] ERROR scraping '${entry.name}': ${e.message}`)
      }
    }
    console.log('\n[DRY RUN complete — no writes performed.]')
    if (values['update-existing']) {
      await updateExistingPokemon(dbPath, allEntries, imagesDir, baseDelay, existingFavLower, {
        dryRun: true,
      })
    }
    return
  }

  // --- Real harvest ---
  fs.mkdirSync(imagesDir, { recursive: true })
  const allSeenFavorites = new Set()
  let added = 0
  let failed = 0

  console.log(`\nHarvesting ${missing.length} pokemon...\n`)
  for (const [i, entry] of missing.entries()) {
    try {
      const detail = await scrapePokemonDetail(entry.slug, baseDelay)
      if (detail === null) {
        console.log(`  [${i + 1}/${missing.length}] SKIP '${entry.name}': extraction failed`)
        failed += 1
        continue
      }

      for (const fav of detail.favorites) {
        allSeenFavorites.add(fav)
      }

      const imagePath = await downloadImage(
        detail.imageUrl,
        detail.imageFilename,
        imagesDir,
        dbPath,
        { table: 'pokemon', column: 'image_path' },
        baseDelay,
      )

      addPokemonToDb(
        dbPath,
        entry.name,
        imagePath,
        detail.habitat,
        detail.favorites,
        existingFavLower,
      )

      console.log(
        `  [${i + 1}/${missing.length}] Added ${entry.name} ` +
          `(habitat=${detail.habitat}, favorites=${JSON.stringify(detail.favorites)})`,
      )
      added += 1
    } catch (e) {
      console.log(`  [${i + 1}/${missing.length}] ERROR adding '${entry.name}': ${e.message}`)
      failed += 1
    }
  }

  flagUnmappedFavorites(allSeenFavorites, existingFavLower)

  if (values['update-existing']) {
    await updateExistingPokemon(dbPath, allEntries, imagesDir, baseDelay, existingFavLower, {
      dryRun: values['dry-run'],
    })
  }

  console.log(
    `\nHarvest complete: added=${added}, failed=${failed}, total on Serebii=${allEntries.length}`,
  )
  const ok = verifyCompleteness(dbPath, allEntries, imagesDir)
  process.exitCode = ok ? 0 : 1
}

// Run when this file is the entry point (mirrors Python's `if __name__ == "__main__"`).
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  await main()
}
