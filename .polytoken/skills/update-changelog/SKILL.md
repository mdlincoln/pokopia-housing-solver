---
description: Summarize git commits since the last changelog entry into weekly buckets and append dated updates to src/changelog.ts, pending operator signoff.
---

# Update changelog (update-changelog)

The repository has a user-facing changelog page at `/changelog` (built-by-Vite
content in `src/changelog.ts`). This skill keeps it current by condensing the
git commit history into dated, weekly-bucketed update entries. **Every update
must be approved by the operator before it lands in `src/changelog.ts`.**

## When to use

- The operator asks to update the changelog (e.g. "update the changelog",
  "add a changelog entry for the recent work").
- Substantial user-facing work has landed on `main` since the last entry.

## Workflow

### 1. Prerequisite check

Run `git rev-parse --is-shallow-repository`. If it prints `true`, the history
is incomplete and you **cannot** reliably summarize it — run
`git fetch --unshallow origin` first, or report the blocker and stop. Do not
fabricate changelog content from memory.

### 2. Read the current state

Open `src/changelog.ts` and read the most recent (first) entry's `date`. The
array is newest-first; each `ChangeLogEntry.date` is an ISO `YYYY-MM-DD`.

`ChangeLogEntry` shape (do not change):

```ts
interface ChangeLogEntry {
  date: string    // ISO YYYY-MM-DD, end of the weekly bucket
  summary: string // one-line headline
  changes: string[] // condensed bullets
}
```

### 3. Collect commits since the last entry

```bash
git log --since="<last date>" --reverse --format='%h %ad %s' --date=short
```

Extend the range back a bit and dedupe against commits already represented by
existing entries if the boundary is ambiguous.

### 4. Condense & summarize — as user-facing release notes

This content is published on the user-facing `/changelog` page. Write it for
players, not developers:

- **Describe what the user can now do**, not how it was built. No implementation
  details: no frameworks, workers, databases, migrations, internal refactors,
  API internals, dependency bumps, or tooling.
- Example good bullet: "Pinned Pokémon stay put when you sort." Example to avoid:
  "Moved solver into a Web Worker and debounced re-solves."
- Drop noise: merge commits, `chore:`/format/dependency non-changes, WIP
  commits, and anything without visible user impact.
- Merge related commits (e.g. a feature plus its follow-up bugfixes) into one
  bullet.
- Match the existing entries' voice and verbosity (short, past tense, plain,
  directly about the player's experience).

### 5. Bucket by week (the debounce)

Group the condensed changes so that **consecutive bucket dates are at least 7
days apart** (minimum one-week buckets). The bucket `date` is the ISO date of
the last commit in that bucket; a `summary` headline synthesizes the bucket's
contents. New entries are authored newest-first and inserted at the top of
`changelog`, so newer dates are smaller indices.

### 6. Propose, do not auto-commit

Render the proposed `ChangeLogEntry[]` additions and **stop for operator
signoff**. Never edit `src/changelog.ts` until the operator explicitly
approves.

### 7. After signoff

Insert the approved entries at the top of `changelog` (newest-first, keeping
the existing entries untouched below), then confirm the invariants still pass:

```bash
npm run test:unit -- --run src/__tests__/changelog.spec.ts
```

or `npm run check`. The changelog invariants (valid ISO dates, non-empty
summary/changes, newest-first, consecutive dates ≥7 days apart, no duplicate
dates) are pinned by `src/__tests__/changelog.spec.ts`.

### 8. Notes on the harness

- An edited/added skill takes effect on `/daemon-reload` (or restart). Until
  then the harness may not see it.
- A single invalid `SKILL.md` is skipped with a TUI warning. The strict check
  is `polytoken validate skill .polytoken/skills/update-changelog/SKILL.md`.
