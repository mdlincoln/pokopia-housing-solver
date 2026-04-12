#!/usr/bin/env node
// @lat: [[lat.md/items#Scraping item tags]]
// Scraper to populate item tags in the SQLite database.
//
// Usage:
//   node scripts/scrape-item-tags.js
//
// Fetches each item page from serebii.net, extracts the "Tag" field,
// and writes it to the items table in the SQLite database.
//
// The script is resumable: items that already have a non-null tag are skipped.

import Database from 'better-sqlite3'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { join } from 'path'
import { JSDOM } from 'jsdom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const dbPath = join(root, 'public', 'pokehousing.sqlite')
const BASE = 'https://www.serebii.net'
const SEED_URL = `${BASE}/pokemonpokopia/items/antiquebed.shtml`
const DELAY_MS = 1500

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Referer: BASE,
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

// ---------------------------------------------------------------------------
// Enumerate item URLs from the seed page's <select name="SelectURL"> element
// ---------------------------------------------------------------------------

function extractItemUrls(html) {
  const dom = new JSDOM(html)
  const sel = dom.window.document.querySelector('select[name="SelectURL"]')
  if (!sel) {
    // Fallback: any select with item paths
    const allSels = dom.window.document.querySelectorAll('select')
    for (const s of allSels) {
      const opts = [...s.querySelectorAll('option')].filter((o) =>
        o.value.includes('/pokemonpokopia/items/'),
      )
      if (opts.length > 5) {
        return opts.map((o) => {
          const v = o.value.trim()
          return v.startsWith('/') ? BASE + v : v
        })
      }
    }
    return []
  }
  return [...sel.querySelectorAll('option')]
    .filter((o) => o.value.includes('/pokemonpokopia/items/'))
    .map((o) => {
      const v = o.value.trim()
      return v.startsWith('/') ? BASE + v : v
    })
}

// ---------------------------------------------------------------------------
// Parse tag from item page
//
// serebii table layout:
//   row 4  : "Category" header, "Tag" header, ...
//   row 5  : [category_val][tag_val][...]
// ---------------------------------------------------------------------------

function parseTagFromPage(html) {
  const dom = new JSDOM(html)
  const doc = dom.window.document
  const rows = [...doc.querySelectorAll('tr')]

  for (let i = 0; i < rows.length; i++) {
    const cells = [...rows[i].querySelectorAll('td')]
    const texts = cells.map((c) => c.textContent.trim())

    // Detect header row for Category / Tag
    if (
      texts.length >= 2 &&
      texts[0] === 'Category' &&
      texts[1] === 'Tag'
    ) {
      // Values are in the next row
      const next = rows[i + 1]
      if (next) {
        const nc = [...next.querySelectorAll('td')]
        const tag = (nc[1]?.textContent ?? '').trim()
        return tag || null
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Open database
  const db = new Database(dbPath)
  db.pragma('foreign_keys = ON')

  // Ensure tag column exists
  try {
    db.exec('ALTER TABLE items ADD COLUMN tag TEXT')
    console.log('Added tag column to items table.')
  } catch {
    // Column already exists, continue
  }

  // Build set of items that already have a tag (for resumability)
  const withTag = new Set()
  for (const row of db.prepare('SELECT name FROM items WHERE tag IS NOT NULL').all()) {
    withTag.add(row.name.toLowerCase())
  }
  console.log(`Items with existing tags: ${withTag.size}\n`)

  // Fetch seed page and enumerate all item URLs
  console.log(`Fetching item list from ${SEED_URL} …`)
  const seedHtml = await fetchHtml(SEED_URL)
  const itemUrls = extractItemUrls(seedHtml)

  if (itemUrls.length === 0) {
    console.error('ERROR: Could not find item select menu on seed page.')
    process.exit(1)
  }

  console.log(`Found ${itemUrls.length} items.\n`)

  // Build lookup of items by name (lowercase → id, name)
  // Also build reverse lookup by slug for matching URL-based names
  const itemsById = new Map()
  const itemsBySlug = new Map()
  for (const row of db.prepare('SELECT id, name FROM items').all()) {
    itemsById.set(row.name.toLowerCase(), { id: row.id, name: row.name })
    // Create slug from name: lowercase, replace spaces with nothing, etc.
    const slug = row.name.toLowerCase().replace(/[^a-z0-9]/g, '')
    itemsBySlug.set(slug, { id: row.id, name: row.name })
  }

  const updateTag = db.prepare('UPDATE items SET tag = ? WHERE id = ?')

  let updated = 0
  let processed = 0

  for (let i = 0; i < itemUrls.length; i++) {
    const url = itemUrls[i]
    const slug = url.split('/').pop().replace('.shtml', '')
    process.stdout.write(`[${i + 1}/${itemUrls.length}] ${slug.padEnd(30)} `)

    let html
    try {
      if (url === SEED_URL) {
        html = seedHtml
      } else {
        await sleep(DELAY_MS)
        html = await fetchHtml(url)
      }
    } catch (err) {
      console.log(`FETCH ERROR: ${err.message}`)
      continue
    }

    let tag
    try {
      tag = parseTagFromPage(html)
    } catch (err) {
      console.log(`PARSE ERROR: ${err.message}`)
      continue
    }

    // Extract item name from page (first td in the HTML)
    let name = ''
    try {
      const dom = new JSDOM(html)
      name = (dom.window.document.querySelector('td')?.textContent ?? '').trim()
    } catch {}

    if (!name) {
      console.log('WARN: no name found')
      continue
    }

    const key = name.toLowerCase()
    const nameSlug = name.toLowerCase().replace(/[^a-z0-9]/g, '')

    if (withTag.has(key)) {
      console.log('skip (already has tag)')
      continue
    }

    // Try exact match first, then slug match
    let item = itemsById.get(key)
    if (!item) {
      item = itemsBySlug.get(nameSlug)
    }
    if (!item) {
      console.log(`no match in DB`)
      continue
    }

    if (tag) {
      const doUpdate = db.transaction(() => {
        updateTag.run(tag, item.id)
      })
      doUpdate()
      withTag.add(key)
      updated++
    }

    processed++
    console.log(`ok${tag ? ` [tag: ${tag}]` : ' [no tag on page]'}`)
  }

  console.log(`\nDone. ${updated} items updated, ${processed} processed.`)

  const summary = db.prepare('SELECT COUNT(*) as total, COUNT(tag) as with_tag FROM items').get()
  console.log(`Items table: ${summary.total} total, ${summary.with_tag} with tag`)

  db.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
