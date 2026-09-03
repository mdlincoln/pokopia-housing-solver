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
  'page-hero',
  'houses-card',
  'pokemon-search-card',
  'house-card',
  'recommended-items',
  'recommended-items-list',
  'add-to-cart',
  'auto-sort-group',
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
  // The walkthrough opens with a text-only welcome step (no element highlighted)
  // before introducing the individual UI features, so it is now ten steps.
  // Both the titles AND the exact description copy are pinned so the intro copy
  // (AC.3) and the original nine steps can't drift silently.
  it('defines exactly the ten steps in walkthrough order', () => {
    const titles = [
      'Welcome to the Pokopia Housing Solver',
      'Set up your houses',
      'Add Pokémon',
      'Meet your house',
      'House items',
      'Combined favorites',
      'Add an item',
      'Needs fulfilled',
      'Auto-sort vs. manual',
      'Save & share your island',
    ]
    const descriptions = [
      'The Pokopia Housing Solver can help you figure out the right roommates for all the ' +
        'Pokemon on your island, and how to give them the best decor to fulfill all their favorites!',
      'Choose how many small (1-slot), medium (2-slot), and large (4-slot) houses you need ' +
        'with each card’s +/− buttons. Clear all resets them to zero.',
      'Type a Pokémon name (e.g. Bulbasaur) in the search box and press Enter to add it to ' +
        'your island. Added Pokémon appear as chips — use ✕ to remove one, or Clear all to ' +
        'start over.',
      'Each house card lists the Pokémon the solver grouped together. Inside, every Pokémon ' +
        'card shows the items that Pokémon loves — the ✓ marks are favorites already covered by ' +
        'items in this house’s cart.',
      'The “House items” button is where you go to see compatible items for this house — ' +
        'things that match the favorites these Pokémon share.',
      'The table header rolls up the favorite items of every Pokémon in this house. Red ' +
        'columns are needs still open; green means a favorite is already covered.',
      'Click + to stock the first recommended item for this house. It will show up in the ' +
        'Shopping Cart on the right.',
      'The item’s ✓ cells show which of the house’s combined favorites it fulfills, and the ' +
        'rest of the table has recalculated to the items still needed.',
      'Leave this ON for automatic assignments. Switch it OFF to arrange Pokémon yourself: ' +
        'drag a Pokémon card onto a house, or use a house’s + button. Turn it back ON to re-sort.',
      'Save current island keeps your setup in this browser. Share island as a link copies a ' +
        'URL you can send to anyone or reopen later.',
    ]
    expect(ONBOARDING_STEPS).toHaveLength(10)
    expect(ONBOARDING_STEPS.map((s) => s.title)).toEqual(titles)
    expect(ONBOARDING_STEPS.map((s) => s.description)).toEqual(descriptions)
  })

  it('only the welcome (intro) step is text-only (highlight === false)', () => {
    expect(ONBOARDING_STEPS[0]!.highlight).toBe(false)
    for (const step of ONBOARDING_STEPS.slice(1)) {
      expect(step.highlight).toBeUndefined()
    }
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
