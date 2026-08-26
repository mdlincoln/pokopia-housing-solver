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

/**
 * Fetch ``url`` and return its HTML as a string. Raises on non-2xx or timeout.
 */
export async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`)
  }
  return decodeHtmlPage(new Uint8Array(await res.arrayBuffer()))
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
