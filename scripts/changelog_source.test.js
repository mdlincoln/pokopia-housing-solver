// Guards the changelog backfill's provenance: every entry date must fall
// within the git commit window, and the newest entry's date must match the
// latest commit date. This is a machine guard against invented backfill
// content — if the history is incomplete (shallow clone) the test auto-skips.
//
// Auto-run by `test:harvest` (node:test over scripts/*.test.js).

import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { PROJECT_ROOT } from './harvest_lib.js'

const CHANGELOG_TS = path.join(PROJECT_ROOT, 'src', 'changelog.ts')

function git(args) {
  return execFileSync('git', args, { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim()
}

function isShallow() {
  try {
    return git(['rev-parse', '--is-shallow-repository']) === 'true'
  } catch {
    return true
  }
}

// Extract the `changelog` array's entry dates from the TS source so this test
// needs no runtime parser. The entries are `{ date: 'YYYY-MM-DD', ... }` blocks.
function entryDatesFromSource() {
  const src = fs.readFileSync(CHANGELOG_TS, 'utf8')
  const dates = []
  const re = /date:\s*'(\d{4}-\d{2}-\d{2})'/g
  let m
  while ((m = re.exec(src)) !== null) dates.push(m[1])
  return dates
}

test('changelog backfill dates fall within the git commit window', (t) => {
  if (isShallow()) {
    t.skip('git history is shallow; cannot verify backfill provenance')
    return
  }

  const dates = entryDatesFromSource()
  assert.ok(dates.length > 0, 'changelog.ts must contain backfilled entries')

  const allDates = git(['log', '--reverse', '--format=%ad', '--date=short']).split('\n')
  const firstCommit = allDates[0]
  const lastCommit = allDates[allDates.length - 1]
  assert.ok(firstCommit && lastCommit, 'could not read git commit window')

  for (const date of dates) {
    assert.ok(
      date >= firstCommit && date <= lastCommit,
      `changelog date ${date} is outside the commit window [${firstCommit}..${lastCommit}]`,
    )
  }
})

test('newest changelog entry date matches the latest commit date', (t) => {
  if (isShallow()) {
    t.skip('git history is shallow; cannot verify backfill provenance')
    return
  }

  const dates = entryDatesFromSource()
  assert.ok(dates.length > 0, 'changelog.ts must contain backfilled entries')
  const newest = dates[0]
  const lastCommit = git(['log', '-1', '--format=%ad', '--date=short'])
  if (!/\d{4}-\d{2}-\d{2}/.test(lastCommit)) {
    t.skip(`could not determine a clean latest commit date (got ${lastCommit})`)
    return
  }
  assert.strictEqual(
    newest,
    lastCommit,
    `newest entry date ${newest} != latest commit ${lastCommit}`,
  )
})
