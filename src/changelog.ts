/**
 * Changelog data for the `/changelog` route.
 *
 * A typed, Vite-bundled module of change-log entries. Entries are authored
 * **newest-first** and rendered in array order by `ChangelogView.vue` — never
 * re-sorted at runtime (mirrors the `items.json` insertion-order rule).
 *
 * Bucketing rule: the `date` of each entry is the ISO `YYYY-MM-DD` of the last
 * commit in that bucket, and **consecutive entry dates are ≥7 days apart**
 * (minimum one-week buckets). This invariant is pinned by
 * `src/__tests__/changelog.spec.ts`.
 *
 * **Tone**: this is user-facing copy published on the site. Describe what
 * players can now *do*, not how it was built. No implementation details
 * (frameworks, workers, databases, migrations, internal refactors, API
 * internals, tooling).
 *
 * Do **not** edit this file by hand. Add entries through the
 * `update-changelog` skill in `.polytoken/skills/update-changelog/SKILL.md`,
 * which summarizes `git log` into dated buckets, converts them to user-facing
 * language, and requires operator signoff before any entry is committed.
 */
export interface ChangeLogEntry {
  /** ISO `YYYY-MM-DD` date marking the end of the weekly bucket. */
  date: string
  /** One-line human headline for the bucket. */
  summary: string
  /** Condensed, user-facing bullet points for the changes in this bucket. */
  changes: string[]
}

export const changelog: ChangeLogEntry[] = [
  // newest first; consecutive dates at least 7 days apart
  {
    date: '2026-08-30',
    summary: 'Take a guided tour, sort on your own, and get roommate suggestions',
    changes: [
      'A guided tour walks new players through setting up homes, adding Pokémon, and saving their island.',
      'A new toggle lets you turn automatic sorting off and arrange Pokémon by hand.',
      'Drag Pokémon between homes, or into the “unhoused” area, when sorting is off.',
      'Each home now shows habitat details and its likely residents.',
      'Get suggestions for the best-fitting Pokémon to add to a home, with a warning when automatic sorting is on.',
    ],
  },
  {
    date: '2026-08-23',
    summary: 'Faster load times, clearer views, and easier island sharing',
    changes: [
      'The site loads faster.',
      'Brought in the newest Pokémon from Serebii’s PokéDex, including the new-DLC additions, for your island.',
      'Saw how much progress you make as the page loads.',
      'Accessibility and reading clarity improved across the whole site.',
      'Share a link to your island, and manage your saved islands from one place.',
      'The layout is tidier on phones and larger screens.',
      'Item recommendations are easier to read and mark off.',
    ],
  },
  {
    date: '2026-07-23',
    summary: 'Stability and documentation for developers',
    changes: ['Improved reliability of the home cards.', 'Better developer documentation.'],
  },
  {
    date: '2026-06-10',
    summary: 'Stability improvements',
    changes: [
      'Pinned Pokémon stay put more reliably.',
      'Made the app more stable when you change your selection.',
    ],
  },
  {
    date: '2026-04-25',
    summary: 'New Pokémon and clearer item tools',
    changes: [
      'Added Mr. Mime, Mime Jr., and the Hoppip family.',
      'Easier to tell which items you can craft and match them to your needs.',
      'A home’s total crafting materials are now listed at the top of the cart.',
    ],
  },
  {
    date: '2026-04-18',
    summary: 'Pin Pokémon, track items, and fine-tune relationships',
    changes: [
      'Pin Pokémon or whole homes so they keep their spot when you sort.',
      'Mark items as crafted or placed in a home to track progress.',
      'Searchable, sortable item lists make recommendations easier to browse.',
      'Pinned homes slide smoothly to the bottom so you can see them at a glance.',
    ],
  },
  {
    date: '2026-04-10',
    summary: 'Welcome to Pokopia Housing Solver',
    changes: [
      'The first release: set up your homes, pick your Pokémon, and get an optimized housing plan.',
      'Homes your Pokémon are grouped by shared favorites, keeping habitat preferences in mind.',
      'Results update as you build your island — no button needed.',
      'Save your island and come back later, or share it with others.',
      'See which items would make each household happiest.',
    ],
  },
]
