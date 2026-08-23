// Guards the compact density token ramp in the theme stylesheet.
//
// All layout spacing in the app flows from the five `--space-*` steps declared
// in :root; the compact, mobile-first density pass retuned them to a 4/8/12/16/24px
// ramp. Pinning the exact values here keeps a future "just bump this one token"
// tweak from silently undoing the density work — compactness is also verified
// against computed layout in e2e/compactness.spec.ts.

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { PROJECT_ROOT } from './harvest_lib.js'

const CSS_PATH = path.join(PROJECT_ROOT, 'src', 'styles', 'tropical-theme.css')
const css = fs.readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// Extract the :root declaration block so assertions can't match re-declarations
// elsewhere in the sheet.
function rootBody() {
  const match = /(^|\n)\s*:root\s*\{/.exec(css)
  assert.ok(match, `:root must exist in ${CSS_PATH}`)
  const openBrace = css.indexOf('{', match.index)
  const closeBrace = css.indexOf('}', openBrace)
  assert.ok(closeBrace > openBrace)
  return css.slice(openBrace + 1, closeBrace)
}

const expectedRamp = [
  ['--space-1', '0.25rem'],
  ['--space-2', '0.5rem'],
  ['--space-3', '0.75rem'],
  ['--space-4', '1rem'],
  ['--space-5', '1.5rem'],
]

for (const [token, value] of expectedRamp) {
  test(`:root ${token} is exactly ${value}`, () => {
    const decl = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(rootBody())
    assert.ok(decl, `${token} must be declared in :root`)
    assert.strictEqual(
      decl[1].trim(),
      value,
      `${token} must be ${value} (compact ramp), got ${decl[1].trim()}`,
    )
  })
}

test(':root declares a single continuous --space-1..5 ramp in order', () => {
  const body = rootBody()
  const indices = expectedRamp.map(([token]) => body.indexOf(token))
  assert.ok(
    indices.every((i) => i !== -1),
    'all five --space-* tokens must live in :root',
  )
  const sorted = [...indices].sort((a, b) => a - b)
  assert.deepStrictEqual(indices, sorted, 'tokens must be declared in ramp order')
})
