// Static a11y pins for the theme stylesheet. Fast node:test companion to the
// Vitest/e2e suites: reduced-motion gating, decorative-glyph alt text, the
// WCAG contrast floor (computed, not eyeballed), and the 24px tap-target pin.

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { PROJECT_ROOT } from './harvest_lib.js'

const CSS_PATH = path.join(PROJECT_ROOT, 'src', 'styles', 'tropical-theme.css')
const css = fs.readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// Extract every `@media (prefers-reduced-motion: reduce) { ... }` block with a
// brace-balanced scan (the theme declares more than one, and a naive first-`}`
// slice would stop at the first inner rule's close brace).
function extractReduceBlocks() {
  const blocks = []
  const re = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g
  let match
  while ((match = re.exec(css)) !== null) {
    let depth = 1
    let i = re.lastIndex
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    assert.strictEqual(depth, 0, 'unbalanced braces inside a reduce block')
    blocks.push(css.slice(match.index, i))
  }
  return blocks
}

// Brace-balanced declaration body of the first rule matching selectorRe.
function ruleBody(selectorRe) {
  const match = selectorRe.exec(css)
  assert.ok(match, `selector ${selectorRe} must exist in ${CSS_PATH}`)
  const openBrace = css.indexOf('{', match.index)
  assert.ok(openBrace !== -1)
  let depth = 1
  let i = openBrace + 1
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') depth--
    i++
  }
  assert.strictEqual(depth, 0, `unbalanced braces in ${selectorRe}`)
  return css.slice(openBrace + 1, i - 1)
}

function srgbToLinear(channel) {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance([r, g, b]) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

function contrastRatio(fgRgb, bgRgb) {
  const [lighter, darker] = [relativeLuminance(fgRgb), relativeLuminance(bgRgb)].sort(
    (a, b) => b - a,
  )
  return (lighter + 0.05) / (darker + 0.05)
}

// Alpha-composite fg over bg (both [r,g,b] 0..255).
function blendOver(fgRgb, alpha, bgRgb) {
  return fgRgb.map((c, i) => alpha * c + (1 - alpha) * bgRgb[i])
}

test('reduced-motion block covers house-move and house-card', () => {
  const blocks = extractReduceBlocks()
  assert.ok(blocks.length >= 1, 'expected at least one prefers-reduced-motion block')
  for (const selector of ['.house-move', '.house-card']) {
    const covered = blocks.some(
      (block) => block.includes(selector) && block.includes('transition: none'),
    )
    assert.ok(
      covered,
      `${selector} must have its transition removed inside a prefers-reduced-motion block`,
    )
  }
})

test('decorative pseudo-content declares empty alt text', () => {
  // CSS alt-text syntax keeps the rendered '*'/' ~' glyphs out of headings'
  // accessible names. Engines without alt-text support (pre-2024) treat the
  // declaration as invalid and drop the glyph entirely — a graceful,
  // decorative-only degradation.
  assert.match(ruleBody(/^\.section-heading::before\s*\{/m), /content:\s*'\*'\s*\/\s*'';/)
  assert.match(ruleBody(/^\.house-title::after\s*\{/m), /content:\s*'\s*~'\s*\/\s*'';/)
})

test('cart-sync-badge uses the pinned higher-contrast cyan', () => {
  assert.match(ruleBody(/\.cart-sync-badge\s*\{/), /color:\s*#1d7089;/)
})

test('checked-off de-emphasis is pinned at the passing opacity', () => {
  assert.match(ruleBody(/\.checked-off\s*\{/), /opacity:\s*0\.8;/)
})

test('base progress-action meets the 24px tap-target floor', () => {
  // `.progress-actions` (plural container) must not satisfy this pattern.
  assert.match(ruleBody(/\.progress-action\s*\{/), /min-height:\s*24px;/)
})

const SAND = [255, 247, 234] // --trop-sand-50 / --bs-body-bg — the real page background
const SKY = [124, 216, 232] // badge chip tint rgb(124 216 232 / N%)
const TROP_TEXT = [42, 76, 91] // --trop-text

test('cart-sync-badge text clears the 4.5:1 floor over its composited chip', () => {
  // The chip is a 22% sky tint over the sand body background (it sits on
  // list-group items whose background is --bs-body-bg).
  const chip = blendOver(SKY, 0.22, SAND)
  const ratio = contrastRatio([29, 112, 137], chip) // #1d7089
  assert.ok(ratio >= 4.5, `badge contrast must be ≥4.5:1, got ${ratio.toFixed(2)}:1`)

  // Sanity guard: the previous colors (#3288a0 ≈4.07:1 per the audit, and the
  // plan's first candidate #1f7892 ≈4.30:1 over this sand composite) both fail
  // the floor — #1d7089 is pinned as the passing step.
  assert.ok(
    contrastRatio([31, 120, 146], chip) < 4.5,
    'guard: #1f7892 over the sand composite is known to fail the floor',
  )
})

test('checked-off rows keep text above the 4.5:1 floor at 0.8 opacity', () => {
  // Effective text: --trop-text, under grayscale(0.4), composited at 0.8 alpha
  // over the sand row background. grayscale() in CSS operates on sRGB channel
  // values with the ITU-R 601 luma weights.
  const gray = 0.2126 * TROP_TEXT[0] + 0.7152 * TROP_TEXT[1] + 0.0722 * TROP_TEXT[2]
  const filtered = TROP_TEXT.map((c) => (1 - 0.4) * c + 0.4 * gray)
  const composited = blendOver(filtered, 0.8, SAND)
  const ratio = contrastRatio(composited, SAND)
  assert.ok(
    ratio >= 4.5,
    `checked-off text contrast must be ≥4.5:1 at opacity 0.8, got ${ratio.toFixed(2)}:1`,
  )

  // 0.6 (the plan's first candidate) composites to ≈3.1:1 over sand and fails;
  // the strikethrough carries the crafted-state signal, so 0.8 keeps the
  // de-emphasis while clearing the floor.
  const at06 = blendOver(filtered, 0.6, SAND)
  assert.ok(
    contrastRatio(at06, SAND) < 4.5,
    'guard: opacity 0.6 over the sand row is known to fail the floor',
  )
})
