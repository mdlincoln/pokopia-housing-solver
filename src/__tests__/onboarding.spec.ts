// Regression net for the pure tour-module logic: the gate helpers and the step
// metadata are the parts of the onboarding feature that are deterministic and
// jsdom-safe. The Popper/focus-trap-backed component behavior lives in e2e.

import { describe, expect, it } from 'vitest'
import {
  isTourSeen,
  markTourSeen,
  ONBOARDING_STEPS,
  shouldAutoStart,
  TOUR_STORAGE_KEY,
} from '@/onboarding'

// The selectors the tour points at, as listed in AGENTS.md's known-testid
// inventory. Keeping this list here double-checks the metadata in the same PR
// that edits the component (selector drift fails the unit suite, not just e2e).
// Compound selectors (e.g. `[data-testid="X"] summary`) register their
// `[data-testid="X"]` ancestor here.
const KNOWN_TESTIDS = new Set([
  'houses-card',
  'pokemon-search-card',
  'house-card',
  'recommended-items',
  'recommended-items-list',
  'add-to-cart',
  'autosort-switch',
  'islands-card',
])

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

describe('onboarding gate helpers', () => {
  it('shouldAutoStart: only a first visit without a URL hash auto-starts', () => {
    const untouched = fakeStorage()

    // seen-flag × URL-hash truth table.
    expect(shouldAutoStart(false, fakeStorage())).toBe(true)
    expect(shouldAutoStart(false, fakeStorage({ [TOUR_STORAGE_KEY]: '1' }))).toBe(false)
    expect(shouldAutoStart(true, fakeStorage())).toBe(false)
    expect(shouldAutoStart(true, fakeStorage({ [TOUR_STORAGE_KEY]: '1' }))).toBe(false)

    // The default storage argument resolves to localStorage in jsdom.
    expect(shouldAutoStart(false, untouched)).toBe(true)
  })

  it('isTourSeen and markTourSeen round-trip on a fake Storage', () => {
    const storage = fakeStorage()
    expect(isTourSeen(storage)).toBe(false)

    markTourSeen(storage)
    expect(isTourSeen(storage)).toBe(true)
    expect(storage.getItem(TOUR_STORAGE_KEY)).toBe('1')
  })

  it('markTourSeen does not disturb unrelated storage keys', () => {
    const storage = fakeStorage({ pokehousing_saved_queries: '[]' })
    markTourSeen(storage)
    expect(storage.getItem('pokehousing_saved_queries')).toBe('[]')
    expect(isTourSeen(storage)).toBe(true)
  })
})

describe('onboarding step metadata', () => {
  it('defines exactly the nine steps in walkthrough order', () => {
    expect(ONBOARDING_STEPS).toHaveLength(9)
    expect(ONBOARDING_STEPS.map((s) => s.title)).toEqual([
      'Set up your houses',
      'Add Pokémon',
      'Meet your house',
      'House items',
      'Combined favorites',
      'Add an item',
      'Needs fulfilled',
      'Auto-sort vs. manual',
      'Save & share your island',
    ])
  })

  it('every step has a unique, non-empty, inventory-listed attachTo selector', () => {
    const selectors = ONBOARDING_STEPS.map((s) => s.attachTo)
    expect(new Set(selectors).size).toBe(selectors.length)

    for (const selector of selectors) {
      // A selector is a bare `[data-testid="X"]` or a descendant of one; the
      // ancestor testid must be registered in KNOWN_TESTIDS.
      const match = /^\[data-testid="([^"]+)"\](?: .+)?$/.exec(selector)
      expect(match, `attachTo must be a data-testid selector, got ${selector}`).not.toBeNull()
      expect(KNOWN_TESTIDS.has(match![1]!)).toBe(true)
    }
  })

  it('every step has non-empty title and description copy', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.title.trim().length).toBeGreaterThan(0)
      expect(step.description.trim().length).toBeGreaterThan(0)
    }
  })
})
