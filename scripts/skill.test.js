// Build-time proxy for the update-changelog skill's validity (AC.4): a strict
// `polytoken validate skill` check belongs to the harness CLI, but this in-repo
// node:test guard ensures the SKILL.md exists with a non-empty `description:`
// frontmatter so CI catches a broken/renamed skill file. Auto-run by
// `test:harvest`.

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { PROJECT_ROOT } from './harvest_lib.js'

const SKILL_PATH = path.join(PROJECT_ROOT, '.polytoken', 'skills', 'update-changelog', 'SKILL.md')

test('update-changelog SKILL.md exists and has a non-empty description in frontmatter', () => {
  assert.ok(fs.existsSync(SKILL_PATH), `missing ${SKILL_PATH}`)
  const content = fs.readFileSync(SKILL_PATH, 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  assert.ok(match, 'SKILL.md must have a YAML frontmatter block delimited by --- lines')
  const frontmatter = match[1]
  const desc = /description\s*:\s*(.+)/.exec(frontmatter)
  assert.ok(desc, 'SKILL.md frontmatter must contain a description: line')
  assert.ok(desc[1].trim().length > 0, 'SKILL.md description must be non-empty')
})
