// Build-time proxy for skill validity: both in-repo SKILL.md files must exist
// with a non-empty `description:` frontmatter so CI catches a broken/renamed
// skill file. For pokopia_update, grep-style content assertions additionally
// prevent a frontmatter-only skeleton from passing. Auto-run by `test:harvest`.

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { PROJECT_ROOT } from './harvest_lib.js'

function skillPath(skillName) {
  return path.join(PROJECT_ROOT, '.polytoken', 'skills', skillName, 'SKILL.md')
}

function readFrontmatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  assert.ok(
    match,
    `${content.slice(0, 40)}... must have a YAML frontmatter block delimited by --- lines`,
  )
  return match[1]
}

for (const skillName of ['update-changelog', 'pokopia_update']) {
  test(`${skillName} SKILL.md exists and has a non-empty description in frontmatter`, () => {
    const p = skillPath(skillName)
    assert.ok(fs.existsSync(p), `missing ${p}`)
    const content = fs.readFileSync(p, 'utf8')
    const frontmatter = readFrontmatter(content)
    const desc = /description\s*:\s*(.+)/.exec(frontmatter)
    assert.ok(desc, `${skillName} SKILL.md frontmatter must contain a description: line`)
    assert.ok(desc[1].trim().length > 0, `${skillName} SKILL.md description must be non-empty`)
  })
}

test('pokopia_update SKILL.md documents the full-sync workflow and guardrails', () => {
  const p = skillPath('pokopia_update')
  const content = fs.readFileSync(p, 'utf8')

  // Full-sync workflow markers.
  assert.match(content, /--update-existing/)
  assert.match(content, /harvest:sync/)

  // The timeout trap: per-step timeout sizing must be documented (the 600s
  // shell default killed a previous run mid-backfill).
  assert.match(content, /timeout_seconds/)

  // Icon-map guardrail: at least one icon-module name must appear.
  assert.match(content, /(spawnIcons\.ts|favoriteIcons\.ts|habitats\.ts)/)

  // Legacy-compat guardrail: the name-pinning contract must be mentioned.
  assert.match(content, /(legacy-hash|legacy_hash|pokemon\.name|items\.name)/)
})
