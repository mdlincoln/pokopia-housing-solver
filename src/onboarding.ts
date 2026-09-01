// Framework-free tour metadata and localStorage gate helpers.
//
// Splitting this out of `OnboardingTour.vue` keeps the parts of the feature
// that are unit-testable in jsdom (gate logic + step content) separate from
// the Popper/focus-trap-backed third-party component, whose real behavior is
// exercised at the e2e layer instead.

/** localStorage key that gates first-visit auto-start for the guided tour. */
export const TOUR_STORAGE_KEY = 'pokehousing_tour_seen'

/** A single tour step: selector for the highlighted target plus its copy. */
export interface OnboardingStep {
  attachTo: string
  title: string
  description: string
}

// The attachTo selector is a CSS selector resolved via `document.querySelector`,
// so compound selectors that descend into a known `[data-testid="..."]` root
// (e.g. a `<summary>` or a table `<thead>`/row) are valid targets too.

/** The island-building walkthrough, in display order. */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    attachTo: '[data-testid="houses-card"]',
    title: 'Set up your houses',
    description:
      'Choose how many small (1-slot), medium (2-slot), and large (4-slot) houses you need ' +
      'with each card’s +/− buttons. Clear all resets them to zero.',
  },
  {
    attachTo: '[data-testid="pokemon-search-card"]',
    title: 'Add Pokémon',
    description:
      'Type a Pokémon name (e.g. Bulbasaur) in the search box and press Enter to add it to ' +
      'your island. Added Pokémon appear as chips — use ✕ to remove one, or Clear all to ' +
      'start over.',
  },
  {
    attachTo: '[data-testid="house-card"]',
    title: 'Meet your house',
    description:
      'Each house card lists the Pokémon the solver grouped together. Inside, every Pokémon ' +
      'card shows the items that Pokémon loves — the ✓ marks are favorites already covered by ' +
      'items in this house’s cart.',
  },
  {
    attachTo: '[data-testid="recommended-items"] summary',
    title: 'House items',
    description:
      'The “House items” button is where you go to see compatible items for this house — ' +
      'things that match the favorites these Pokémon share.',
  },
  {
    attachTo: '[data-testid="recommended-items-list"] thead',
    title: 'Combined favorites',
    description:
      'The table header rolls up the favorite items of every Pokémon in this house. Red ' +
      'columns are needs still open; green means a favorite is already covered.',
  },
  {
    attachTo: '[data-testid="add-to-cart"]',
    title: 'Add an item',
    description:
      'Click + to stock the first recommended item for this house. It will show up in the ' +
      'Shopping Cart on the right.',
  },
  {
    attachTo: '[data-testid="recommended-items-list"] tbody tr.recommendation-added-row',
    title: 'Needs fulfilled',
    description:
      'The item’s ✓ cells show which of the house’s combined favorites it fulfills, and the ' +
      'rest of the table has recalculated to the items still needed.',
  },
  {
    attachTo: '[data-testid="auto-sort-group"]',
    title: 'Auto-sort vs. manual',
    description:
      'Leave this ON for automatic assignments. Switch it OFF to arrange Pokémon yourself: ' +
      'drag a Pokémon card onto a house, or use a house’s + button. Turn it back ON to re-sort.',
  },
  {
    attachTo: '[data-testid="islands-card"]',
    title: 'Save & share your island',
    description:
      'Save current island keeps your setup in this browser. Share island as a link copies a ' +
      'URL you can send to anyone or reopen later.',
  },
]

type ReadonlyStorage = Pick<Storage, 'getItem'>

/**
 * True when the tour has been completed or skipped before (any non-null value
 * under `TOUR_STORAGE_KEY`), matching the `pokehousing_*` boolean-key style.
 */
export function isTourSeen(storage: ReadonlyStorage = localStorage): boolean {
  return storage.getItem(TOUR_STORAGE_KEY) != null
}

/** Persist the "seen" flag so the tour never auto-plays again. */
export function markTourSeen(storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(TOUR_STORAGE_KEY, '1')
}

/**
 * Auto-start only on a first visit that did NOT arrive via a shared URL hash
 * (sharing encodes the whole scenario in the hash; hijacking those visitors
 * onto a sample island would clobber the state they came to see).
 */
export function shouldAutoStart(
  hasUrlHash: boolean,
  storage: ReadonlyStorage = localStorage,
): boolean {
  return !isTourSeen(storage) && !hasUrlHash
}
