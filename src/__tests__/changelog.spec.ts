import { changelog, type ChangeLogEntry } from '@/changelog'
import { describe, expect, it } from 'vitest'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MIN_BUCKET_GAP_DAYS = 7

function daysBetween(a: string, b: string): number {
  return (Date.parse(a) - Date.parse(b)) / 86_400_000
}

describe('changelog data module', () => {
  it('is non-empty once the backfill has been authored', () => {
    expect(changelog.length).toBeGreaterThan(0)
  })

  it('every entry has a valid ISO date, non-empty summary, and non-empty changes', () => {
    for (const entry of changelog) {
      expect(ISO_DATE.test(entry.date), `invalid date ${entry.date}`).toBe(true)
      expect(new Date(entry.date).toString(), `unparseable date ${entry.date}`).not.toBe(
        'Invalid Date',
      )
      expect(entry.summary.trim().length).toBeGreaterThan(0)
      expect(entry.changes.length).toBeGreaterThan(0)
      for (const change of entry.changes) {
        expect(change.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('entries are sorted newest-first', () => {
    for (let i = 1; i < changelog.length; i++) {
      const prev = changelog[i - 1]!
      const cur = changelog[i]!
      expect(prev.date > cur.date, `not newest-first at index ${i}`).toBe(true)
    }
  })

  it('consecutive entry dates are at least 7 days apart (weekly bucket minimum)', () => {
    for (let i = 1; i < changelog.length; i++) {
      const prev = changelog[i - 1]!
      const cur = changelog[i]!
      const gap = daysBetween(prev.date, cur.date)
      expect(
        gap >= MIN_BUCKET_GAP_DAYS,
        `dates ${prev.date} and ${cur.date} are only ${gap} days apart`,
      ).toBe(true)
    }
  })

  it('contains no duplicate dates', () => {
    const dates = new Set(changelog.map((e) => e.date))
    expect(dates.size).toBe(changelog.length)
  })

  it('entries conform to the ChangeLogEntry shape', () => {
    for (const entry of changelog) {
      const keys = Object.keys(entry).sort()
      expect(keys).toEqual(['changes', 'date', 'summary'])
      const typed = entry as ChangeLogEntry
      expect(Array.isArray(typed.changes)).toBe(true)
    }
  })

  it('entries are written as user-facing release notes without implementation details', () => {
    // A conservative, explicit ban-list of implementation/tooling jargon. Keep
    // this in sync with the `update-changelog` skill's tone rules: changelog
    // copy must tell players what they can now do, not how it was built.
    const TECH_TERMS = [
      'worker',
      'Web Worker',
      'sql.js',
      'sqlite',
      'database',
      'migration',
      'schema',
      'refactor',
      'decompose',
      'composable',
      'dependency',
      'vue-tsc',
      'vue-tour',
      'v-onboarding',
      'node',
      'API',
      'Serebii harvest',
      'harvest',
      'build:data',
      'build-time',
      'bundl',
      'git',
      'commit',
      'fix:',
      'chore:',
      'feat(',
      'README',
      'AGENTS.md',
    ]
    const text = changelog
      .flatMap((e) => [e.summary, ...e.changes])
      .join(' ')
      .toLowerCase()
    for (const term of TECH_TERMS) {
      expect(
        text.includes(term.toLowerCase()),
        `changelog entry mentions implementation detail "${term}"`,
      ).toBe(false)
    }
  })
})
