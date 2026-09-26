// Shared helpers for the Serebii harvest scripts.
//
// Stdlib only: node:fs, node:path, node:url, node:sqlite, and the global
// fetch/TextDecoder/AbortSignal. No third-party dependencies.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const IMAGE_BASE = 'https://www.serebii.net'

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(SCRIPTS_DIR, '..')
export const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'src', 'pokehousing.sqlite')
export const DEFAULT_IMAGES_DIR = path.join(PROJECT_ROOT, 'public', 'images')

// ---------------------------------------------------------------------------
// HTML decoding / helpers
// ---------------------------------------------------------------------------

/**
 * Decode an HTML page byte buffer to a string.
 *
 * Serebii pages are latin-1 / windows-1252 encoded (traditional), but a few may
 * be UTF-8. Try strict UTF-8 first; on failure fall back to windows-1252
 * (mirrors the Python "try utf-8, except -> latin-1/windows-1252" behavior).
 */
export function decodeHtmlPage(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

// A full harvest makes a few hundred requests over several minutes, so a single
// transient socket reset must not abort the run. Retry transport failures and
// the retryable status codes with exponential backoff.
const FETCH_MAX_ATTEMPTS = 4
const FETCH_RETRY_BASE_MS = 1000

function isRetryableStatus(status) {
  return status === 429 || status >= 500
}

/**
 * Fetch ``url`` and return its HTML as a string.
 *
 * Retries transient failures (connection resets, timeouts, 429/5xx) with
 * exponential backoff. Permanent failures — any other 4xx — raise immediately.
 */
export async function fetchPage(url) {
  let lastError
  for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      })
      if (res.ok) {
        return decodeHtmlPage(new Uint8Array(await res.arrayBuffer()))
      }
      const err = new Error(`HTTP ${res.status} fetching ${url}`)
      if (!isRetryableStatus(res.status)) {
        err.permanent = true
      }
      throw err
    } catch (e) {
      if (e.permanent) {
        throw e
      }
      lastError = e
      if (attempt < FETCH_MAX_ATTEMPTS) {
        const backoffMs = FETCH_RETRY_BASE_MS * 2 ** (attempt - 1)
        console.log(
          `  RETRY ${attempt}/${FETCH_MAX_ATTEMPTS - 1} for ${url} ` +
            `after ${e.message} (waiting ${backoffMs}ms)`,
        )
        await sleep(backoffMs)
      }
    }
  }
  throw lastError
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Sleep for a jittered duration between ``baseDelay`` and 3 seconds.
 * Short-circuits to no sleep when ``baseDelay <= 0`` (used by tests).
 */
export async function jitteredDelay(baseDelay) {
  if (baseDelay <= 0) {
    return
  }
  const ms = baseDelay * 1000 + Math.random() * (3000 - baseDelay * 1000)
  await sleep(ms)
}

/** Trim leading/trailing whitespace (including U+00A0, as Python `.strip()` does). */
export function stripWs(text) {
  return text.replace(/^\s+|\s+$/g, '')
}

/** Remove HTML tags from ``text`` and strip surrounding whitespace. */
export function stripTags(text) {
  return stripWs(text.replace(/<[^>]+>/g, ''))
}

// Named HTML entities observed in Serebii content plus the full latin-1
// accented-letter set (python's html.unescape decodes all of these).
const NAMED_ENTITIES = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: '\u00A0',
  quot: '"',
  // ISO-8859-1 symbols and punctuation.
  iexcl: '\u00A1',
  cent: '\u00A2',
  pound: '\u00A3',
  curren: '\u00A4',
  yen: '\u00A5',
  brvbar: '\u00A6',
  sect: '\u00A7',
  uml: '\u00A8',
  copy: '\u00A9',
  ordf: '\u00AA',
  laquo: '\u00AB',
  not: '\u00AC',
  shy: '\u00AD',
  reg: '\u00AE',
  macr: '\u00AF',
  deg: '\u00B0',
  plusmn: '\u00B1',
  sup2: '\u00B2',
  sup3: '\u00B3',
  acute: '\u00B4',
  micro: '\u00B5',
  para: '\u00B6',
  middot: '\u00B7',
  cedil: '\u00B8',
  sup1: '\u00B9',
  ordm: '\u00BA',
  raquo: '\u00BB',
  frac14: '\u00BC',
  frac12: '\u00BD',
  frac34: '\u00BE',
  iquest: '\u00BF',
  // Uppercase latin-1 letters.
  Agrave: '\u00C0',
  Aacute: '\u00C1',
  Acirc: '\u00C2',
  Atilde: '\u00C3',
  Auml: '\u00C4',
  Aring: '\u00C5',
  AElig: '\u00C6',
  Ccedil: '\u00C7',
  Egrave: '\u00C8',
  Eacute: '\u00C9',
  Ecirc: '\u00CA',
  Euml: '\u00CB',
  Igrave: '\u00CC',
  Iacute: '\u00CD',
  Icirc: '\u00CE',
  Iuml: '\u00CF',
  ETH: '\u00D0',
  Ntilde: '\u00D1',
  Ograve: '\u00D2',
  Oacute: '\u00D3',
  Ocirc: '\u00D4',
  Otilde: '\u00D5',
  Ouml: '\u00D6',
  times: '\u00D7',
  Oslash: '\u00D8',
  Ugrave: '\u00D9',
  Uacute: '\u00DA',
  Ucirc: '\u00DB',
  Uuml: '\u00DC',
  Yacute: '\u00DD',
  THORN: '\u00DE',
  szlig: '\u00DF',
  // Lowercase latin-1 letters.
  agrave: '\u00E0',
  aacute: '\u00E1',
  acirc: '\u00E2',
  atilde: '\u00E3',
  auml: '\u00E4',
  aring: '\u00E5',
  aelig: '\u00E6',
  ccedil: '\u00E7',
  egrave: '\u00E8',
  eacute: '\u00E9',
  ecirc: '\u00EA',
  euml: '\u00EB',
  igrave: '\u00EC',
  iacute: '\u00ED',
  icirc: '\u00EE',
  iuml: '\u00EF',
  eth: '\u00F0',
  ntilde: '\u00F1',
  ograve: '\u00F2',
  oacute: '\u00F3',
  ocirc: '\u00F4',
  otilde: '\u00F5',
  ouml: '\u00F6',
  divide: '\u00F7',
  oslash: '\u00F8',
  ugrave: '\u00F9',
  uacute: '\u00FA',
  ucirc: '\u00FB',
  uuml: '\u00FC',
  yacute: '\u00FD',
  thorn: '\u00FE',
  yuml: '\u00FF',
  // Additional common punctuation/typographic entities.
  OElig: '\u0152',
  oelig: '\u0153',
  Scaron: '\u0160',
  scaron: '\u0161',
  Yuml: '\u0178',
  fnof: '\u0192',
  circ: '\u02C6',
  tilde: '\u02DC',
  ndash: '\u2013',
  mdash: '\u2014',
  lsquo: '\u2018',
  rsquo: '\u2019',
  sbquo: '\u201A',
  ldquo: '\u201C',
  rdquo: '\u201D',
  bdquo: '\u201E',
  dagger: '\u2020',
  Dagger: '\u2021',
  bull: '\u2022',
  hellip: '\u2026',
  permil: '\u2030',
  prime: '\u2032',
  Prime: '\u2033',
  lsaquo: '\u2039',
  rsaquo: '\u203A',
  oline: '\u203E',
  frasl: '\u2044',
  euro: '\u20AC',
}

const NAMED_RE = new RegExp(`&(${Object.keys(NAMED_ENTITIES).join('|')});`, 'g')

/**
 * Decode HTML entities: named first (the map above), then numeric ``&#...;``
 * and ``&#x...;`` forms. Mirrors Python's ``html.unescape`` for Serebii content.
 */
export function unescapeHtml(text) {
  let out = text.replace(NAMED_RE, (_m, name) => NAMED_ENTITIES[name])
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) =>
    String.fromCodePoint(Number.parseInt(hex, 16)),
  )
  out = out.replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
  return out
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

export function openReadOnlyDb(dbPath) {
  return new DatabaseSync(dbPath, { readOnly: true })
}

export function openWritableDb(dbPath) {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys=ON')
  return db
}

/**
 * Derive an item/pokemon slug from a DB ``picture_path``/``image_path`` value,
 * e.g. ``images/<slug>.png`` -> ``<slug>`` (mirrors Python's ``rsplit(".", 1)``).
 */
export function slugFromPicturePath(picturePath) {
  const filename = picturePath.replace(/^images\//, '')
  const idx = filename.lastIndexOf('.')
  return idx === -1 ? filename : filename.slice(0, idx)
}

// ---------------------------------------------------------------------------
// Capitalization normalization
// ---------------------------------------------------------------------------

// The only (table, column) pairs the casing normalizer may ever touch. Any
// other pair makes normalizeColumnCasing throw, which also prevents arbitrary
// SQL identifier interpolation (same guard pattern as IMAGE_COLUMNS).
//
// Hard exclusions, and why:
//   - items.name / pokemon.name / habitat_entries.name / favorites.name —
//     pinned by the legacy-hash compatibility contract (old URL hashes and
//     saved islands resolve these names byte-for-byte; see
//     scripts/legacy_compat.test.js). They must NEVER be renamed — including
//     "just" re-capitalized.
//   - habitats.habitat / pokemon.habitat — FK targets of the habitats axis.
//   - items.tag — validated vocabulary (VALID_TAGS).
//   - habitat_pokemon.pokemon_name — must stay byte-identical to pokemon.name.
export const CASING_NORMALIZATION_TARGETS = [
  { table: 'items', column: 'category', keyColumns: ['id'] },
  { table: 'habitat_entries', column: 'category', keyColumns: ['id'] },
  { table: 'habitat_recipe', column: 'item_name', keyColumns: ['habitat_id', 'item_name'] },
  { table: 'habitat_pokemon', column: 'rarity', keyColumns: ['habitat_id', 'pokemon_name'] },
  {
    table: 'habitat_pokemon_location',
    column: 'location',
    keyColumns: ['habitat_id', 'pokemon_name', 'location'],
  },
  {
    table: 'habitat_pokemon_time',
    column: 'time',
    keyColumns: ['habitat_id', 'pokemon_name', 'time'],
  },
  {
    table: 'habitat_pokemon_weather',
    column: 'weather',
    keyColumns: ['habitat_id', 'pokemon_name', 'weather'],
  },
]

/**
 * Title-case a lowercase key. Used only as a tie-break *preference* when
 * picking the canonical casing for a lowercased group: it never rewrites
 * values that don't already exist — it only makes an existing variant win a
 * tie.
 */
function titleCaseKey(key) {
  return key.replace(/\b\w/g, (c) => c.toUpperCase())
}

// Composite keys are joined with NUL for the in-memory dry-run key set; the
// byte cannot appear in any of these vocabulary values.
const KEY_SEP = '\u0000'

function compositeKey(target, row) {
  return target.keyColumns.map((k) => row[k]).join(KEY_SEP)
}

/**
 * Normalize the capitalization of one allowlisted column by majority rule.
 *
 * For every distinct casing of the same lowercase value, the most frequent
 * variant wins; ties prefer the title-cased variant, then the
 * lexicographically smallest. Minority rows are either UPDATEd to the
 * canonical value or — when a row with the same primary key but the canonical
 * value already exists — merged (deleted); the discarded quantity/mapping
 * surfaces in the report's ``mergedDeleted`` count.
 *
 * Returns a per-(from, to) change report; with ``dryRun`` the same report is
 * computed with zero writes (mutations are simulated in memory).
 */
export function normalizeColumnCasing(dbPath, table, column, { dryRun = false } = {}) {
  const target = CASING_NORMALIZATION_TARGETS.find((t) => t.table === table && t.column === column)
  if (!target) {
    throw new Error(
      `normalizeColumnCasing: (table, column) pair '${table}.${column}' is not in ` +
        `CASING_NORMALIZATION_TARGETS; refusing to run`,
    )
  }

  const selectSql = `SELECT ${target.keyColumns.join(', ')}, ${column} FROM ${table}`
  const ro = openReadOnlyDb(dbPath)
  let rows
  try {
    rows = ro.prepare(selectSql).all()
  } finally {
    ro.close()
  }

  // Group rows by lowercased value, then by exact value.
  const groups = new Map() // lower -> Map(value -> rows[])
  for (const row of rows) {
    const value = row[column]
    if (value === null || value === undefined) {
      continue
    }
    const lower = value.toLowerCase()
    if (!groups.has(lower)) {
      groups.set(lower, new Map())
    }
    const byValue = groups.get(lower)
    if (!byValue.has(value)) {
      byValue.set(value, [])
    }
    byValue.get(value).push(row)
  }

  const report = new Map() // `${from} -> ${to}` -> { table, column, from, to, updated, mergedDeleted }

  // In-memory key set, kept in sync with (simulated or real) mutations so
  // dry-run collision checks mirror what the live run would see. Keyed by
  // composite key + column value, mirroring the live probe (which includes
  // `AND column = canonical`) — for non-key-column targets the key alone
  // would match the minority row itself.
  const rowKeyStr = (row) => `${compositeKey(target, row)}${KEY_SEP}${String(row[column])}`
  const keySet = new Set(rows.map(rowKeyStr))
  // PK-collision probe: a row with this row's key values but the canonical
  // column value. The `column = ?` condition is redundant when the column is
  // part of the key, but essential for non-key targets (items.category,
  // habitat_pokemon.rarity, ...) where the key conditions alone would match
  // the minority row itself and turn every update into a delete.
  const existsSql = `SELECT 1 FROM ${table} WHERE ${target.keyColumns
    .map((k) => `${k} = ?`)
    .join(' AND ')} AND ${column} = ?`
  const db = dryRun ? null : openWritableDb(dbPath)
  try {
    const whereClause = target.keyColumns.map((k) => `${k} = ?`).join(' AND ')
    const updateStmt = db
      ? db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${whereClause}`)
      : null
    const deleteStmt = db ? db.prepare(`DELETE FROM ${table} WHERE ${whereClause}`) : null
    const existsStmt = db ? db.prepare(existsSql) : null

    for (const [lower, byValue] of groups) {
      if (byValue.size <= 1) {
        continue
      }

      // Deterministic canonical pick: count desc, title-case preference,
      // then lexicographic.
      const titleCase = titleCaseKey(lower)
      const variants = [...byValue.keys()].sort((a, b) => {
        const ca = byValue.get(a).length
        const cb = byValue.get(b).length
        if (cb !== ca) {
          return cb - ca
        }
        const ta = a === titleCase ? 1 : 0
        const tb = b === titleCase ? 1 : 0
        if (tb !== ta) {
          return tb - ta
        }
        return a < b ? -1 : a > b ? 1 : 0
      })
      const canonical = variants[0]

      for (const variant of variants.slice(1)) {
        for (const row of byValue.get(variant)) {
          // PK-collision check: does a row with this row's key values but the
          // canonical column value already exist? If so the UPDATE would
          // violate the primary key — merge by deleting the minority row
          // instead (the surviving canonical row keeps its own quantity).
          const targetKey = target.keyColumns.map((k) => (k === column ? canonical : row[k]))
          const targetKeyStr = targetKey.join(KEY_SEP) + KEY_SEP + canonical
          const taken = dryRun
            ? keySet.has(targetKeyStr)
            : existsStmt.get(...targetKey, canonical) !== undefined

          const reportKey = `${variant} -> ${canonical}`
          if (!report.has(reportKey)) {
            report.set(reportKey, {
              table,
              column,
              from: variant,
              to: canonical,
              updated: 0,
              mergedDeleted: 0,
            })
          }

          if (taken) {
            if (!dryRun) {
              deleteStmt.run(...target.keyColumns.map((k) => row[k]))
            } else {
              keySet.delete(rowKeyStr(target, row))
            }
            report.get(reportKey).mergedDeleted += 1
          } else {
            if (!dryRun) {
              updateStmt.run(canonical, ...target.keyColumns.map((k) => row[k]))
            } else {
              keySet.delete(rowKeyStr(target, row))
              keySet.add(targetKeyStr)
            }
            report.get(reportKey).updated += 1
          }
        }
      }
    }
  } finally {
    if (db) {
      db.close()
    }
  }

  return [...report.values()]
}

// Item image slugs whose Serebii source files are permanently 404 as of
// 2026-09. verifyItemsCompleteness prints their missing-on-disk images as
// warnings and excludes them from the ok aggregate, so the --verify exit gate
// and the &&-chained npm scripts never halt on these two permanent upstream
// gaps. Once Serebii uploads a sprite, the --update-existing image self-heal
// downloads it — remove the slug from this list to re-arm the check.
export const KNOWN_MISSING_IMAGE_SLUGS = ['seabedflowerseeds(purple)', 'pokemoncenterrebuildkit']

// Whitelist of valid (table, column) pairs for the generic image-collision
// check. Prevents interpolating arbitrary identifiers into SQL.
const IMAGE_COLUMNS = {
  pokemon: new Set(['image_path']),
  items: new Set(['picture_path']),
}

/**
 * Download a sprite image to ``imagesDir/destFilename``.
 *
 * Collision check: if the file already exists and a row references it, skip
 * (already present). If the file exists but no row references it, overwrite
 * (stale file from a prior partial run). Returns the DB-bound ``images/<name>``.
 */
export async function downloadImage(
  imageUrl,
  destFilename,
  imagesDir,
  dbPath,
  { table, column },
  baseDelay,
) {
  const allowed = IMAGE_COLUMNS[table]
  if (!allowed || !allowed.has(column)) {
    throw new Error(`downloadImage: invalid table/column ${table}.${column}`)
  }

  const destPath = path.join(imagesDir, destFilename)
  const dbImagePath = `images/${destFilename}`

  if (fs.existsSync(destPath)) {
    const db = openReadOnlyDb(dbPath)
    try {
      const row = db
        .prepare(`SELECT COUNT(*) AS cnt FROM ${table} WHERE ${column} = ?`)
        .get(dbImagePath)
      if (row.cnt > 0) {
        console.log(`    Image already present and referenced: ${dbImagePath} (skip)`)
        return dbImagePath
      }
    } finally {
      db.close()
    }
    console.log(`    Stale file exists, overwriting: ${destPath}`)
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
