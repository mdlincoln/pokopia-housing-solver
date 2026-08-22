// Guards the dvh-with-vh-fallback convention in the theme stylesheet.
//
// Mobile browsers grow/shrink the dynamic viewport as chrome (URL bar) shows
// and hides, so a plain 100vh layout jumps on scroll. 100dvh tracks the
// dynamic viewport; engines without dvh need the same property set to 100vh
// *first* (CSS source order = fallback). These tests pin that ordering at the
// two call sites that size the app shell.

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { PROJECT_ROOT } from './harvest_lib.js'

const CSS_PATH = path.join(PROJECT_ROOT, 'src', 'styles', 'tropical-theme.css')
const css = fs.readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// Extract the declaration block (between the first { } after the selector
// match) for a selector regex, so assertions can't drift across rules.
function ruleBody(selectorRe) {
  const match = selectorRe.exec(css)
  assert.ok(match, `selector ${selectorRe} must exist in ${CSS_PATH}`)
  const openBrace = css.indexOf('{', match.index)
  assert.ok(openBrace !== -1)
  const closeBrace = css.indexOf('}', openBrace)
  assert.ok(closeBrace > openBrace)
  return css.slice(openBrace + 1, closeBrace)
}

function assertFallbackOrder(body, property) {
  const vhDecl = `${property}: 100vh;`
  const dvhDecl = `${property}: 100dvh;`
  const vhIndex = body.indexOf(vhDecl)
  assert.ok(vhIndex !== -1, `must declare ${vhDecl} as the fallback`)
  const rest = body.slice(vhIndex + vhDecl.length).trimStart()
  assert.ok(
    rest.startsWith(dvhDecl),
    `${dvhDecl} must immediately follow ${vhDecl} (source order = fallback), got: ${JSON.stringify(rest.slice(0, 60))}`,
  )
}

test('body min-height declares 100vh immediately followed by 100dvh', () => {
  assertFallbackOrder(ruleBody(/^body\s*\{/m), 'min-height')
})

test('cart sidebar panel height declares 100vh immediately followed by 100dvh', () => {
  assertFallbackOrder(ruleBody(/\.cart-sidebar-panel\.offcanvas-lg\s*\{/), 'height')
})
