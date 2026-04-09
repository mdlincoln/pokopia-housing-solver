#!/usr/bin/env node
// One-time scraper for Pokémon Pokopia item data from serebii.net.
//
// Usage:
//   node scripts/scrape-pokopia-items.js
//
// Output:
//   public/items.jsonl          — one JSON object per line
//   public/images/{slug}.png    — item images (skips already-downloaded)
//
// The script is resumable: already-written items (by name) are skipped.

import { createWriteStream, existsSync, readFileSync, writeFileSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { JSDOM } from 'jsdom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const imagesDir = join(root, 'public', 'images')
const jsonlPath = join(root, 'public', 'items.jsonl')
const BASE = 'https://www.serebii.net'
const SEED_URL = `${BASE}/pokemonpokopia/items/honey.shtml`
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

async function downloadImage(imageUrl, destPath) {
  if (existsSync(destPath)) return
  const res = await fetch(imageUrl, { headers: { Referer: BASE } })
  if (!res.ok) throw new Error(`Image HTTP ${res.status} for ${imageUrl}`)
  writeFileSync(destPath, Buffer.from(await res.arrayBuffer()))
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
// Parse a single item page
//
// serebii table layout (rows are 0-indexed):
//   row 0  : name (single cell)
//   row 1  : "Picture" header
//   row 4  : [Category][Tag][Paintable][Requirements]  ← header labels
//   row 5  : [category_val][tag_val][paintable_val][req_val]  ← actual values
//   row 6  : (cs2)[Trade Value] (cs2)[Favorite Categories]   ← header labels
//   row 7  : (cs2)[merged] [std] [amt] [Favorite:] [fav_amt] (cs2)[fav_cats]
//   row 10 : "Flavor Text" header
//   row 11 : flavor text body
//   row 13 : "Recipe" header (optional; only for crafted items)
//   row 14+: recipe rows  "ItemName * N" per ingredient cell
// ---------------------------------------------------------------------------

function parseItemPage(html, pageUrl) {
  const dom = new JSDOM(html)
  const doc = dom.window.document

  // Name
  const name = (doc.querySelector('td')?.textContent ?? '').trim()

  // Image — derive slug from URL for reliability
  const slug = pageUrl.split('/').pop().replace('.shtml', '')
  const picture = `images/${slug}.png`

  const rows = [...doc.querySelectorAll('tr')]

  let category = ''
  let tag = ''
  let flavor_text = ''
  const favorite_categories = []
  const recipe = []

  for (let i = 0; i < rows.length; i++) {
    const cells = [...rows[i].querySelectorAll('td')]
    const texts = cells.map((c) => c.textContent.trim())

    // Detect header row for Category / Tag / Paintable / Requirements
    if (
      texts.length >= 2 &&
      texts[0] === 'Category' &&
      texts[1] === 'Tag'
    ) {
      // Values are in the next row
      const next = rows[i + 1]
      if (next) {
        const nc = [...next.querySelectorAll('td')]
        category = (nc[0]?.textContent ?? '').trim()
        tag = (nc[1]?.textContent ?? '').trim()
      }
    }

    // Detect header row for Trade Value / Favorite Categories
    // Row has exactly 2 cells both with colSpan >= 2: "Trade Value" and "Favorite Categories"
    if (
      texts.length === 2 &&
      cells[0]?.colSpan >= 2 &&
      cells[1]?.colSpan >= 2 &&
      texts[0].includes('Trade Value') &&
      texts[1].includes('Favorite')
    ) {
      // Data row is the next row — last cell (cs:2) contains favorite categories
      const next = rows[i + 1]
      if (next) {
        const nc = [...next.querySelectorAll('td')]
        // Last cell (colSpan 2) is favorite categories; serebii separates with <br> tags
        const lastCell = nc[nc.length - 1]
        if (lastCell && lastCell.colSpan >= 2) {
          // Replace <br> with newlines, then split
          const raw = lastCell.innerHTML.replace(/<br\s*\/?>/gi, '\n')
          const stripped = raw.replace(/<[^>]+>/g, '').trim()
          if (stripped) {
            favorite_categories.push(
              ...stripped
                .split(/\n/)
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        }
      }
    }

    // Detect "Flavor Text" header (single-cell row)
    if (texts.length === 1 && texts[0] === 'Flavor Text') {
      const next = rows[i + 1]
      if (next) {
        flavor_text = (next.querySelector('td')?.textContent ?? '').trim()
      }
    }

    // Detect "Recipe" header (single-cell row, possibly with colSpan)
    if (texts.length === 1 && texts[0] === 'Recipe') {
      // Parse subsequent rows for ingredients until next section header
      for (let j = i + 1; j < rows.length; j++) {
        const rc = [...rows[j].querySelectorAll('td')]
        const rt = rc.map((c) => c.textContent.trim())

        // Stop at a new section header (single-cell row with colSpan, non-ingredient text)
        if (rc.length === 1 && rc[0].colSpan >= 2 && !rt[0].match(/\*\s*\d/)) break

        // Look for "ItemName * N" patterns in each non-merged cell.
        // Skip cs:2 cells — they are summary cells that concatenate all ingredients.
        for (const cell of rc) {
          if (cell.colSpan > 1) continue
          const txt = cell.textContent.trim()
          const m = txt.match(/^(.+?)\s*\*\s*(\d+)$/)
          if (m) {
            const itemName = m[1].trim()
            const number = parseInt(m[2], 10)
            if (!recipe.some((r) => r.item === itemName)) {
              recipe.push({ item: itemName, number })
            }
          }
        }
      }
    }
  }

  return { picture, name, category, tag, recipe, flavor_text, favorite_categories }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await mkdir(imagesDir, { recursive: true })

  // Track already-written items for resumability
  const written = new Set()
  if (existsSync(jsonlPath)) {
    for (const line of readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean)) {
      try {
        const obj = JSON.parse(line)
        if (obj.name) written.add(obj.name)
      } catch {}
    }
    console.log(`Resuming: ${written.size} items already recorded.`)
  }

  // Fetch seed page and enumerate all item URLs
  console.log(`Fetching item list from ${SEED_URL} …`)
  const seedHtml = await fetchHtml(SEED_URL)
  const itemUrls = extractItemUrls(seedHtml)

  if (itemUrls.length === 0) {
    console.error('ERROR: Could not find item select menu on seed page.')
    process.exit(1)
  }

  console.log(`Found ${itemUrls.length} items to scrape.\n`)

  const out = createWriteStream(jsonlPath, { flags: 'a' })
  let successCount = 0

  for (let i = 0; i < itemUrls.length; i++) {
    const url = itemUrls[i]
    const slug = url.split('/').pop().replace('.shtml', '')
    process.stdout.write(`[${i + 1}/${itemUrls.length}] ${slug.padEnd(30)} `)

    let html
    try {
      html = url === SEED_URL ? seedHtml : (await sleep(DELAY_MS), await fetchHtml(url))
    } catch (err) {
      console.log(`FETCH ERROR: ${err.message}`)
      continue
    }

    let item
    try {
      item = parseItemPage(html, url)
    } catch (err) {
      console.log(`PARSE ERROR: ${err.message}`)
      continue
    }

    if (!item.name) {
      console.log('WARN: no name found')
      continue
    }

    if (written.has(item.name)) {
      console.log('skip')
      continue
    }

    const imageSrc = `${BASE}/pokemonpokopia/items/${slug}.png`
    const imageDest = join(imagesDir, `${slug}.png`)
    try {
      await downloadImage(imageSrc, imageDest)
    } catch {
      // non-fatal: image may not exist for all items
    }

    out.write(JSON.stringify(item) + '\n')
    written.add(item.name)
    successCount++
    console.log(`ok  [cat: ${item.category || '?'}] [faves: ${item.favorite_categories.length}] [recipe: ${item.recipe.length}]`)
  }

  out.end()
  console.log(`\nDone. ${successCount} new items written (${written.size} total) → ${jsonlPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
