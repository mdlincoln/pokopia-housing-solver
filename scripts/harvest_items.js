// Harvest missing items from Serebii's Pokopia item database into the local
// SQLite DB. Stdlib-only port of the former scripts/harvest_items.py.
//
// Scrapes Serebii's favorites-category list pages (43 pages) and the
// comprehensive items listing, then fetches each missing item's detail page to
// extract the sprite image URL, category, tag, flavor text, and crafting
// recipe. Items are inserted in a two-pass approach (all items first, then
// recipes + favorites) to satisfy foreign-key constraints.

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
  slugFromPicturePath,
  stripTags,
  unescapeHtml,
} from './harvest_lib.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FAVORITES_START_URL = 'https://www.serebii.net/pokemonpokopia/favorites/blockystuff.shtml'
const ITEMS_LIST_URL = 'https://www.serebii.net/pokemonpokopia/items.shtml'
const DETAIL_URL_TMPL = 'https://www.serebii.net/pokemonpokopia/items/{}.shtml'

const VALID_TAGS = new Set(['Decoration', 'Toy', 'Relaxation', 'Road', 'Food'])

// ---------------------------------------------------------------------------
// Regexes (ported from Python; flags i/s map from re.IGNORECASE/re.DOTALL)
// ---------------------------------------------------------------------------

// Matches <option value="/pokemonpokopia/favorites/<slug>.shtml"><Display Name></option>
const FAVORITE_NAV_RE =
  /<option value="\/pokemonpokopia\/favorites\/([^"]+)\.shtml">([^<]+)<\/option>/g

// Matches item name links on favorites pages (absolute URL, with <u> tags).
const FAVORITES_ITEM_RE = /<a href="\/pokemonpokopia\/items\/([^"]+)\.shtml"><u>([^<]+)<\/u><\/a>/g

// Matches item links on the items.shtml listing (relative URL, with <u> tags).
const LIST_ITEM_RE = /<a href="items\/([^"]+)\.shtml"><u>([^<]+)<\/u><\/a>/g

const ITEM_NAME_RE = /<h1>([^<]+)<\/h1>/i

const ITEM_IMG_RE = /<td class="pkmn"><img src="([^"]+)"/i

// Block between the Category header and the Trade Value header.
const CAT_TAG_BLOCK_RE =
  /<td class="fooevo"[^>]*>Category<\/td>(.*?)(?:<td class="fooevo"[^>]*>Trade Value)/is

// All <td class="cen"> cells within the Category→Trade Value block.
const CEN_CELL_RE = /<td class="cen">(.*?)<\/td>/gis

// Flavor text: between <h2>Flavor Text</h2> and the next </table> or <h2>.
const FLAVOR_TEXT_RE = /<h2>Flavor Text<\/h2>(.*?)(?:<h2>|<\/table>|$)/is

// Favorite Categories on detail page (colspan="2" cell).
const DETAIL_FAVORITES_RE =
  /Favorite Categories<\/td>.*?<td class="cen"[^>]*colspan="2"[^>]*>(.*?)<\/td>/is

// Favourite links inside the detail page Favorite Categories cell.
const FAV_LINK_RE = /<a href="\/pokemonpokopia\/favorites\/([^"]+)\.shtml"><u>([^<]+)<\/u><\/a>/g

// Recipe section: between <h2>Recipe</h2> and the next <h2> or end.
const RECIPE_SECTION_RE = /<h2>Recipe<\/h2>(.*?)(?:<h2>|$)/is

// Recipe ingredient rows: <a href="<slug>.shtml"><u>Name</u></a> * N
const RECIPE_ITEM_RE = /<a href="([^"]+)\.shtml"><u>([^<]+)<\/u><\/a>\s*\*\s*(\d+)/gi

// ---------------------------------------------------------------------------
// Pure parsers (operate on an already-fetched HTML string; exported for tests)
// ---------------------------------------------------------------------------

export function parseFavoritesNavHtml(html) {
  const seen = new Set()
  const categories = []
  for (const m of html.matchAll(FAVORITE_NAV_RE)) {
    const slug = m[1]
    if (seen.has(slug)) {
      continue
    }
    seen.add(slug)
    categories.push({ slug, displayName: unescapeHtml(m[2]) })
  }
  return categories
}

export function parseFavoritesPageHtml(html, favDisplayName) {
  const favoriteName = favDisplayName.toLowerCase()
  const results = []
  for (const m of html.matchAll(FAVORITES_ITEM_RE)) {
    const slug = m[1]
    const name = unescapeHtml(m[2]).trim()
    results.push({ item: { slug, name, source: 'favorites' }, favName: favoriteName })
  }
  return results
}

export function parseItemsListingHtml(html) {
  const itemsBySlug = new Map()
  for (const m of html.matchAll(LIST_ITEM_RE)) {
    const slug = m[1]
    if (itemsBySlug.has(slug)) {
      continue
    }
    const name = unescapeHtml(m[2]).trim()
    itemsBySlug.set(slug, { slug, name, source: 'listing' })
  }
  return [...itemsBySlug.values()]
}

/**
 * Parse a single item detail page. Returns the full detail object, or ``null``
 * on incomplete extraction (missing image_url or category).
 */
export function parseItemDetailHtml(html, slug) {
  // --- Name ---
  let name = slug // fallback
  const nameMatch = ITEM_NAME_RE.exec(html)
  if (nameMatch) {
    name = unescapeHtml(nameMatch[1]).trim()
  }

  // --- Image URL ---
  let imageUrl = null
  const imgMatch = ITEM_IMG_RE.exec(html)
  if (imgMatch) {
    imageUrl = imgMatch[1]
  }

  let imageFilename = null
  if (imageUrl) {
    imageFilename = imageUrl.split('/').at(-1)
  }

  // --- Category & Tag ---
  let category = null
  let tag = null
  const blockMatch = CAT_TAG_BLOCK_RE.exec(html)
  if (blockMatch) {
    const block = blockMatch[1]
    const cenCells = [...block.matchAll(CEN_CELL_RE)].map((m) => m[1])
    if (cenCells.length > 0) {
      category = stripTags(unescapeHtml(cenCells[0]))
      if (!category) {
        category = null
      }
    }
    if (cenCells.length > 1) {
      tag = stripTags(unescapeHtml(cenCells[1]))
      if (!tag || tag === '\u00A0') {
        tag = null
      }
    }
  }

  // --- Flavor Text ---
  let flavorText = null
  const ftMatch = FLAVOR_TEXT_RE.exec(html)
  if (ftMatch) {
    flavorText = stripTags(unescapeHtml(ftMatch[1]))
    if (!flavorText) {
      flavorText = null
    }
  }

  // --- Recipe ---
  const recipe = []
  const recipeMatch = RECIPE_SECTION_RE.exec(html)
  if (recipeMatch) {
    const recipeSection = recipeMatch[1]
    for (const m of recipeSection.matchAll(RECIPE_ITEM_RE)) {
      const ingSlug = m[1]
      const ingName = unescapeHtml(m[2]).trim()
      const count = Number.parseInt(m[3], 10)
      recipe.push({ slug: ingSlug, name: ingName, count })
    }
  }

  // --- Favorite Categories (supplementary) ---
  const favorites = []
  const favSectionMatch = DETAIL_FAVORITES_RE.exec(html)
  if (favSectionMatch) {
    const favSection = favSectionMatch[1]
    for (const m of favSection.matchAll(FAV_LINK_RE)) {
      favorites.push(unescapeHtml(m[2]).trim())
    }
  }

  // --- Validation ---
  if (imageUrl === null || category === null) {
    console.log(
      `  WARNING: incomplete extraction for '${slug}': ` +
        `image_url=${imageUrl}, category=${category}, tag=${tag}`,
    )
    return null
  }

  return {
    slug,
    name,
    imageUrl,
    imageFilename,
    category,
    tag,
    flavorText,
    recipe,
    favorites,
  }
}

// ---------------------------------------------------------------------------
// Orchestration (fetch + parse; keep Python parity names)
// ---------------------------------------------------------------------------

export async function scrapeFavoritesNav(baseDelay) {
  console.log(`Fetching favorites navigation: ${FAVORITES_START_URL}`)
  const pageHtml = await fetchPage(FAVORITES_START_URL)
  const categories = parseFavoritesNavHtml(pageHtml)
  await jitteredDelay(baseDelay)
  console.log(`Discovered ${categories.length} favorite category pages.`)
  return categories
}

export async function scrapeFavoritesPage(favUrl, favDisplayName, baseDelay) {
  const pageHtml = await fetchPage(favUrl)
  const results = parseFavoritesPageHtml(pageHtml, favDisplayName)
  await jitteredDelay(baseDelay)
  return results
}

export async function scrapeAllFavoritesPages(baseDelay, categories = null) {
  if (categories === null) {
    categories = await scrapeFavoritesNav(baseDelay)
  }

  const itemsBySlug = new Map()
  const favoritesMap = new Map()

  console.log(`\nScraping ${categories.length} favorites pages...`)
  for (const [i, cat] of categories.entries()) {
    const favUrl = `https://www.serebii.net/pokemonpokopia/favorites/${cat.slug}.shtml`
    console.log(`  [${i + 1}/${categories.length}] ${cat.displayName} (${cat.slug})`)
    const results = await scrapeFavoritesPage(favUrl, cat.displayName, baseDelay)
    for (const { item, favName } of results) {
      if (!itemsBySlug.has(item.slug)) {
        itemsBySlug.set(item.slug, item)
      }
      if (!favoritesMap.has(item.slug)) {
        favoritesMap.set(item.slug, new Set())
      }
      favoritesMap.get(item.slug).add(favName)
    }
  }

  console.log(
    `\nDiscovered ${itemsBySlug.size} unique items across ${categories.length} favorites pages.`,
  )
  return {
    items: new Set(itemsBySlug.values()),
    favoritesMap,
    categories,
  }
}

export async function scrapeItemsListing(baseDelay) {
  console.log(`\nFetching items listing: ${ITEMS_LIST_URL}`)
  const pageHtml = await fetchPage(ITEMS_LIST_URL)
  const items = parseItemsListingHtml(pageHtml)
  await jitteredDelay(baseDelay)
  console.log(`Discovered ${items.length} unique items from the listing page.`)
  return new Set(items)
}

export async function scrapeItemDetail(slug, baseDelay) {
  const url = DETAIL_URL_TMPL.replace('{}', slug)
  let pageHtml
  try {
    pageHtml = await fetchPage(url)
  } catch (e) {
    console.log(`  ERROR fetching detail page for '${slug}': ${e.message}`)
    return null
  }
  const detail = parseItemDetailHtml(pageHtml, slug)
  if (detail !== null) {
    await jitteredDelay(baseDelay)
  }
  return detail
}

// ---------------------------------------------------------------------------
// Comparison / DB helpers
// ---------------------------------------------------------------------------

export function getExistingItems(dbPath) {
  const db = openReadOnlyDb(dbPath)
  try {
    const rows = db.prepare('SELECT id, name, picture_path FROM items').all()
    const namesLower = new Set()
    const nameMap = new Map()
    const slugMap = new Map()
    for (const { id, name, picture_path: picturePath } of rows) {
      namesLower.add(name.toLowerCase())
      nameMap.set(name.toLowerCase(), name)
      if (picturePath) {
        slugMap.set(slugFromPicturePath(picturePath), id)
      }
    }
    return { namesLower, nameMap, slugMap }
  } finally {
    db.close()
  }
}

export function findMissingItems(allSerebiiItems, existingNamesLower) {
  return [...allSerebiiItems].filter((item) => !existingNamesLower.has(item.name.toLowerCase()))
}

export function addItemToDb(dbPath, name, imagePath, category, tag, flavorText) {
  if (tag !== null && tag !== undefined && !VALID_TAGS.has(tag)) {
    console.log(`    WARNING: tag '${tag}' not in VALID_TAGS; storing as-is`)
  }
  const db = openWritableDb(dbPath)
  try {
    const result = db
      .prepare(
        'INSERT INTO items (id, name, category, picture_path, flavor_text, tag) ' +
          'VALUES (NULL, ?, ?, ?, ?, ?)',
      )
      .run(name, category, imagePath, flavorText, tag)
    return result.lastInsertRowid
  } finally {
    db.close()
  }
}

export function addRecipeForItem(dbPath, itemId, recipe, slugMap) {
  const db = openWritableDb(dbPath)
  try {
    const insert = db.prepare(
      'INSERT OR IGNORE INTO item_recipe (item_id, ingredient_id, COUNT) VALUES (?, ?, ?)',
    )
    for (const ingredient of recipe) {
      const ingId = slugMap.get(ingredient.slug)
      if (ingId === undefined) {
        console.log(
          `    WARNING: recipe ingredient '${ingredient.name}' ` +
            `(slug '${ingredient.slug}') not in DB; skipping recipe row`,
        )
        continue
      }
      insert.run(itemId, ingId, ingredient.count)
    }
  } finally {
    db.close()
  }
}

export function addFavoritesForItem(dbPath, itemId, favoriteNames, existingFavLower) {
  const db = openWritableDb(dbPath)
  try {
    const insert = db.prepare(
      'INSERT OR IGNORE INTO item_favorites (item_id, favorite_name) VALUES (?, ?)',
    )
    for (const fav of favoriteNames) {
      const favLower = fav.toLowerCase()
      if (!existingFavLower.has(favLower)) {
        console.log(
          `    WARNING: favorite '${fav}' not in favorites table; ` +
            `skipping item_favorites entry`,
        )
        continue
      }
      insert.run(itemId, favLower)
    }
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Backfill favorites / recipes
// ---------------------------------------------------------------------------

export function backfillFavorites(dbPath, favoritesMap, slugMap, existingFavLower) {
  console.log('\n--- Backfilling favorites for existing items ---')

  // Build a name_lower -> item_id map for fallback lookups.
  const ro = openReadOnlyDb(dbPath)
  let nameLowerToId
  try {
    nameLowerToId = new Map(
      ro
        .prepare('SELECT id, name FROM items')
        .all()
        .map((row) => [row.name.toLowerCase(), row.id]),
    )
  } finally {
    ro.close()
  }

  let backfilled = 0
  for (const [slug, favNames] of favoritesMap) {
    // Look up item_id: try slug_map first, then name-based lookup.
    let itemId = slugMap.get(slug)
    if (itemId === undefined) {
      itemId = nameLowerToId.get(slug.replace(/-/g, ' '))
      if (itemId === undefined) {
        continue
      }
    }

    const db = openWritableDb(dbPath)
    try {
      const existing = new Set(
        db
          .prepare('SELECT favorite_name FROM item_favorites WHERE item_id = ?')
          .all(itemId)
          .map((row) => row.favorite_name),
      )

      const insert = db.prepare(
        'INSERT OR IGNORE INTO item_favorites (item_id, favorite_name) VALUES (?, ?)',
      )
      for (const fav of favNames) {
        if (!existingFavLower.has(fav)) {
          continue
        }
        if (existing.has(fav)) {
          continue
        }
        insert.run(itemId, fav)
        backfilled += 1
      }
    } finally {
      db.close()
    }
  }

  console.log(`Backfilled ${backfilled} item_favorites entries.`)
}

export async function backfillRecipes(dbPath, slugMap, baseDelay) {
  const ro = openReadOnlyDb(dbPath)
  let itemsWithoutRecipes
  try {
    itemsWithoutRecipes = ro
      .prepare(
        'SELECT i.id, i.name, i.picture_path FROM items i ' +
          'WHERE NOT EXISTS (SELECT 1 FROM item_recipe r WHERE r.item_id = i.id)',
      )
      .all()
  } finally {
    ro.close()
  }

  if (itemsWithoutRecipes.length === 0) {
    console.log('\n--- Recipe backfill: all items already have recipes (or none) ---')
    return
  }

  console.log(
    `\n--- Backfilling recipes for ${itemsWithoutRecipes.length} items without recipes ---`,
  )

  // Refresh slug_map to include newly inserted items.
  const { slugMap: freshSlugMap } = getExistingItems(dbPath)
  for (const [k, v] of freshSlugMap) {
    slugMap.set(k, v)
  }

  let backfilled = 0
  let skipped = 0
  for (const { id: itemId, name, picture_path: picturePath } of itemsWithoutRecipes) {
    if (!picturePath) {
      skipped += 1
      continue
    }

    const slug = slugFromPicturePath(picturePath)
    const detail = await scrapeItemDetail(slug, baseDelay)
    if (detail === null) {
      skipped += 1
      continue
    }
    if (detail.recipe.length === 0) {
      skipped += 1
      continue
    }

    addRecipeForItem(dbPath, itemId, detail.recipe, slugMap)
    console.log(`  Backfilled recipe for '${name}' (${detail.recipe.length} ingredients)`)
    backfilled += 1
  }

  console.log(`Recipe backfill: ${backfilled} updated, ${skipped} skipped (no recipe).`)
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export function verifyItemsCompleteness(dbPath, allSerebiiItems, imagesDir, serebiiFavorites) {
  const db = openReadOnlyDb(dbPath)
  let dbNamesLower
  let validFavorites
  let allItems
  let ifRows
  let recipeRows
  let validItemIds
  try {
    dbNamesLower = new Set(
      db
        .prepare('SELECT name FROM items')
        .all()
        .map((row) => row.name.toLowerCase()),
    )
    validFavorites = new Set(
      db
        .prepare('SELECT name FROM favorites')
        .all()
        .map((r) => r.name),
    )
    allItems = db.prepare('SELECT id, name, picture_path FROM items').all()
    ifRows = db.prepare('SELECT item_id, favorite_name FROM item_favorites').all()
    recipeRows = db.prepare('SELECT item_id, ingredient_id FROM item_recipe').all()
    validItemIds = new Set(
      db
        .prepare('SELECT id FROM items')
        .all()
        .map((r) => r.id),
    )
  } finally {
    db.close()
  }

  const serebiiNamesLower = new Set([...allSerebiiItems].map((e) => e.name.toLowerCase()))
  const missing = new Set([...serebiiNamesLower].filter((n) => !dbNamesLower.has(n)))
  const extra = new Set([...dbNamesLower].filter((n) => !serebiiNamesLower.has(n)))

  console.log('\n' + '='.repeat(60))
  console.log('VERIFICATION REPORT')
  console.log('='.repeat(60))
  console.log(`Serebii unique items: ${serebiiNamesLower.size}`)
  console.log(`DB items count:       ${dbNamesLower.size}`)
  if (missing.size > 0) {
    console.log(`\nMISSING from DB (${missing.size}):`)
    for (const name of [...missing].sort()) {
      console.log(`  - ${name}`)
    }
  } else {
    console.log('\nMissing from DB: none')
  }
  if (extra.size > 0) {
    console.log(`\nExtra in DB (not on Serebii, ${extra.size}):`)
    for (const name of [...extra].sort()) {
      console.log(`  + ${name}`)
    }
  } else {
    console.log('Extra in DB: none')
  }

  const violations = []

  // 1. Every item has non-null picture_path
  for (const { id, name, picture_path: picturePath } of allItems) {
    if (picturePath === null || picturePath === '') {
      violations.push(`item '${name}' (id=${id}) has null/empty picture_path`)
    }
  }

  // 2. Every item_favorites entry has valid item_id and favorite_name FKs
  for (const { item_id: itemId, favorite_name: favName } of ifRows) {
    if (!validItemIds.has(itemId)) {
      violations.push(`item_favorites orphan: item_id=${itemId} not in items table`)
    }
    if (!validFavorites.has(favName)) {
      violations.push(
        `item_favorites orphan (item_id=${itemId}): favorite_name '${favName}' not in favorites table`,
      )
    }
  }

  // 3. Every item_recipe entry has valid item_id and ingredient_id FKs
  for (const { item_id: itemId, ingredient_id: ingredientId } of recipeRows) {
    if (!validItemIds.has(itemId)) {
      violations.push(`item_recipe orphan: item_id=${itemId} not in items table`)
    }
    if (!validItemIds.has(ingredientId)) {
      violations.push(
        `item_recipe orphan: ingredient_id=${ingredientId} not in items table ` +
          `(for item_id=${itemId})`,
      )
    }
  }

  // 4. Every picture_path file exists on disk
  for (const { name, picture_path: picturePath } of allItems) {
    if (picturePath) {
      const localFile = path.join(imagesDir, picturePath.replace(/^images\//, ''))
      if (!fs.existsSync(localFile)) {
        violations.push(`item '${name}': image file missing on disk: ${localFile}`)
      }
    }
  }

  // 5. Every favorite in favorites table matches a Serebii favorite category
  const serebiiFavLower = new Set(serebiiFavorites.map((f) => f.toLowerCase()))
  for (const fav of validFavorites) {
    if (!serebiiFavLower.has(fav.toLowerCase())) {
      violations.push(`favorites table entry '${fav}' has no Serebii favorite category match`)
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

// ---------------------------------------------------------------------------
// CLI / main
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/harvest_items.js [options]

Harvest missing items from Serebii's Pokopia item database.

Options:
  --dry-run          Scrape and report what would be added, but do not write.
  --verify           Skip harvesting; run the completeness + integrity check only.
  --db <path>        Path to the SQLite DB (default: ${DEFAULT_DB_PATH})
  --images-dir <dir> Directory for sprite images (default: ${DEFAULT_IMAGES_DIR})
  --delay <seconds>  Base request delay in seconds; actual delay is jittered to [delay, 3.0].
  -h, --help         Show this help message and exit.
`

function mergeDiscovered(favItems, listingItems) {
  // Deduplicate by slug, prefer listing name (listing overrides favorites).
  const merged = new Map()
  for (const item of favItems) {
    merged.set(item.slug, item)
  }
  for (const item of listingItems) {
    merged.set(item.slug, item)
  }
  return new Set(merged.values())
}

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
    const favCategories = await scrapeFavoritesNav(baseDelay)
    const serebiiFavorites = favCategories.map((c) => c.displayName)
    const { items: allFavItems } = await scrapeAllFavoritesPages(baseDelay, favCategories)
    const listingItems = await scrapeItemsListing(baseDelay)
    const allItems = mergeDiscovered(allFavItems, listingItems)
    verifyItemsCompleteness(dbPath, allItems, imagesDir, serebiiFavorites)
    return
  }

  // --- Harvest mode (dry-run or real) ---
  console.log('Fetching Serebii favorites pages...')
  const {
    items: allFavItems,
    favoritesMap,
    categories: favCategories,
  } = await scrapeAllFavoritesPages(baseDelay)
  const serebiiFavorites = favCategories.map((c) => c.displayName)

  const listingItems = await scrapeItemsListing(baseDelay)
  const allItems = mergeDiscovered(allFavItems, listingItems)

  const { namesLower: existingNamesLower, slugMap } = getExistingItems(dbPath)

  // Get existing favorites from DB for FK validation.
  const ro = openReadOnlyDb(dbPath)
  let existingFavLower
  try {
    existingFavLower = new Set(
      ro
        .prepare('SELECT name FROM favorites')
        .all()
        .map((r) => r.name.toLowerCase()),
    )
  } finally {
    ro.close()
  }

  const missing = findMissingItems(allItems, existingNamesLower)
  const existingCount = allItems.size - missing.length

  console.log(
    `\nFound ${allItems.size} items on Serebii, ` +
      `${existingCount} already in DB, ${missing.length} to add.`,
  )

  if (missing.length === 0 && !values['dry-run']) {
    console.log('Nothing to add. Running verification...')
    verifyItemsCompleteness(dbPath, allItems, imagesDir, serebiiFavorites)
    return
  }

  if (missing.length === 0 && values['dry-run']) {
    console.log('[DRY RUN] No missing items found.')
    return
  }

  // --- Dry run ---
  if (values['dry-run']) {
    console.log(`\n[DRY RUN] Would add ${missing.length} items:\n`)
    for (const [i, entry] of missing.entries()) {
      try {
        const detail = await scrapeItemDetail(entry.slug, baseDelay)
        if (detail === null) {
          console.log(
            `  [${i + 1}/${missing.length}] DRY RUN: would add ${entry.name} ` +
              `(EXTRACTION FAILED — see warnings above)`,
          )
          continue
        }
        const favs = favoritesMap.get(entry.slug) ?? new Set()
        console.log(
          `  [${i + 1}/${missing.length}] DRY RUN: would add ${detail.name}\n` +
            `    slug=${entry.slug}\n` +
            `    category=${detail.category}\n` +
            `    tag=${detail.tag}\n` +
            `    flavor_text=${detail.flavorText}\n` +
            `    recipe=${JSON.stringify(detail.recipe)}\n` +
            `    favorites=${JSON.stringify([...favs].sort())}`,
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

  console.log(`\nHarvesting ${missing.length} items (Pass 1: item metadata)...\n`)
  const insertedDetails = []
  let added = 0
  let failed = 0

  for (const [i, entry] of missing.entries()) {
    try {
      const detail = await scrapeItemDetail(entry.slug, baseDelay)
      if (detail === null) {
        console.log(`  [${i + 1}/${missing.length}] SKIP '${entry.name}': extraction failed`)
        failed += 1
        continue
      }

      const imagePath = await downloadImage(
        detail.imageUrl,
        detail.imageFilename,
        imagesDir,
        dbPath,
        { table: 'items', column: 'picture_path' },
        baseDelay,
      )

      const itemId = addItemToDb(
        dbPath,
        detail.name,
        imagePath,
        detail.category,
        detail.tag,
        detail.flavorText,
      )
      slugMap.set(entry.slug, itemId)

      insertedDetails.push({ itemId, detail })

      console.log(
        `  [${i + 1}/${missing.length}] Added ${detail.name} ` +
          `(category=${detail.category}, tag=${detail.tag})`,
      )
      added += 1
    } catch (e) {
      console.log(`  [${i + 1}/${missing.length}] ERROR adding '${entry.name}': ${e.message}`)
      failed += 1
    }
  }

  console.log(
    `\nPass 2: inserting recipes and favorites for ${insertedDetails.length} new items...\n`,
  )
  for (const { itemId, detail } of insertedDetails) {
    if (detail.recipe.length > 0) {
      addRecipeForItem(dbPath, itemId, detail.recipe, slugMap)
    }

    const favNames = new Set()
    if (favoritesMap.has(detail.slug)) {
      for (const f of favoritesMap.get(detail.slug)) {
        favNames.add(f)
      }
    }
    for (const f of detail.favorites) {
      favNames.add(f)
    }

    if (favNames.size > 0) {
      addFavoritesForItem(dbPath, itemId, favNames, existingFavLower)
    }
  }

  backfillFavorites(dbPath, favoritesMap, slugMap, existingFavLower)
  await backfillRecipes(dbPath, slugMap, baseDelay)

  console.log(
    `\nHarvest complete: added=${added}, failed=${failed}, total on Serebii=${allItems.size}`,
  )
  verifyItemsCompleteness(dbPath, allItems, imagesDir, serebiiFavorites)
}

// Run when this file is the entry point (mirrors Python's `if __name__ == "__main__"`).
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  await main()
}
