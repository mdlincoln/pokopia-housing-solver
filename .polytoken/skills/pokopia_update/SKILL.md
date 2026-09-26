---
description: Keep Pokopia's item/pokemon/habitat tables in sync with Serebii — insert new records, refresh existing ones (full sync), normalize capitalization, and bake payloads, with mandatory snapshot + dry-run safety steps.
---

# Pokopia data update (pokopia_update)

Keep the three Serebii-backed domains of `src/pokehousing.sqlite` — items,
pokemon, and habitat entries — in sync with the live site. A **default** harvest
is insert-only; a **sync** (`--update-existing`) additionally refreshes existing
rows and full-syncs their sub-records: recipe rows, favorite mappings, spawn
rosters, and spawn join-table values **absent from Serebii's live pages are
deleted**. Top-level rows (`items`/`pokemon`/`habitat_entries`) are **never**
auto-deleted — they are report-only, and any real removal is an explicit manual
step (see step 10).

## When to use

- The operator asks to "update/sync Pokopia data", "check for new
  items/pokemon/habitats", or something similar.
- After a known Serebii site update, or as periodic drift maintenance.

## Workflow

### 1. Preflight & snapshot

Deletions are part of sync, so a rollback path is mandatory.

```bash
git status --porcelain          # record repo state before touching anything
cp src/pokehousing.sqlite /tmp/pokehousing-pre-sync-$(date +%Y%m%d-%H%M).sqlite
```

`src/pokehousing.sqlite` is git-committed, so a committed checkout is a second
rollback path. Payloads (`src/data/*.json`, `public/data/adjacency.json`,
`public/data/tombstones.json`) are gitignored build artifacts — only the sqlite
is committed.

### 2. Dry-run first (~15 min each)

```bash
npm run harvest:pokemon -- --update-existing --dry-run
npm run harvest:habitats -- --update-existing --dry-run
npm run harvest:items -- --dry-run
node scripts/normalize_capitalization.js --dry-run
```

These preview the **destructive sub-record deletion deltas** — the riskiest
part of the sync. Report the full delta to the operator before writing,
deletions called out explicitly. The items
`--update-existing --dry-run` (~50 min on its own: 1698 detail pages) is
optional at operator discretion — its insert-only dry run covers new items, and
the preflight snapshot + git-committed sqlite remain the rollback paths.

### 3. Full sync (~115 min total)

Run the three harvests as **separate background jobs**, then normalize and
bake, inspecting each step's exit code before proceeding (failure localization,
correctly-sized timeouts):

```bash
node scripts/harvest_items.js --update-existing      # 1698 pages — timeout_seconds >= 7200
node scripts/harvest_pokemon.js --update-existing    #  367 pages — timeout_seconds >= 3600
node scripts/harvest_habitats.js --update-existing   #  252 pages — timeout_seconds >= 3600
npm run normalize:casing
npm run build:data
```

The per-step timeouts are derived as pages x ~3s mean jittered delay plus retry
headroom; total wall-clock is ~115 min (~45 min insert + ~70 min update). A
single `npm run harvest:sync` background job is acceptable only with
`timeout_seconds >= 9000` — above, not below, the ~6900s estimate. **Never use
the 600s shell default**: it killed a previous run mid-backfill.

`harvest:all` (insert-only harvests + normalization + bake) exists for adding
new content without refresh semantics.

### 4. Normalize capitalization

`npm run normalize:casing` (already part of `harvest:sync`). Majority rule per
column: ties prefer the title-cased variant, then the lexicographically
smallest. `node scripts/normalize_capitalization.js --verify` exits nonzero
while non-canonical casing remains — usable as a CI gate. Name columns
(`items.name`, `pokemon.name`, `favorites.name`, ...) are hard-excluded by the
allowlist and can never be re-cased.

### 5. Bake payloads

Included in `harvest:sync`; standalone is `npm run build:data`. Payloads are
gitignored — only `src/pokehousing.sqlite` is committed. The bake emits five
payloads, including the fetched tombstone map
(`public/data/tombstones.json`) built from the `*_tombstones` tables; a failed
bake with `Tombstone cycle`/`Tombstone orphan` is a maintainer error in the
tombstone tables, never something to patch in the payload by hand.

### 6. Verify

```bash
npm run harvest:items -- --verify
npm run harvest:pokemon -- --verify
npm run harvest:habitats -- --verify
```

Exit codes now gate: nonzero means a real failure. The two known upstream 404
items (`seabedflowerseeds(purple)`, `pokemoncenterrebuildkit`) are allowlisted
in `verifyItemsCompleteness` (`KNOWN_MISSING_IMAGE_SLUGS` in
`scripts/harvest_lib.js`) in both of their possible shapes — a row present but
sprite file missing, or (for the seed item, whose sprite has always 404'd) the
row still absent pending a retried insert — so neither shape can ever cause a
nonzero exit. Therefore **any** items-verify failure is a real regression,
full stop — there is no "pre-existing failure" category. The default insert
pass places allowlisted slugs even when their image download fails (row with a
missing sprite file, rebuildkit precedent); `--update-existing` self-heal
retries the download every run. Once Serebii uploads a sprite, remove the slug
from the allowlist to re-arm the check.

### 7. Tests

```bash
npm run test:harvest
npx vitest run src/__tests__/favoriteIcons.spec.ts
```

### 8. Icon-map rule

A harvest that adds or renames a favorite/habitat/time/weather value must add
the icon mapping (`src/favoriteIcons.ts` `FAVORITE_ICONS`, `src/habitats.ts`
`HABITAT_ICONS`, `src/spawnIcons.ts` `SPAWN_TIME_ICONS`/`SPAWN_WEATHER_ICONS`)
plus the matching `?raw` import in `src/iconSvg.ts` — or the suite fails.

### 9. Legacy-compat guardrail

Never rename `items.name` / `pokemon.name` / `habitat_entries.name` **by hand or
via the harvest scripts**, and never normalize those columns: old URL hashes and
saved islands resolve these names byte-for-byte
(`scripts/legacy_compat.test.js`, `scripts/legacy_storage_compat.test.js`).
Renames **are** allowed through the tombstone CLI (step 10) — the harvest
scripts themselves still never rename, ever.

### 10. Report & manual top-level decisions

Print a per-table delta summary (added/updated/deleted sub-records per domain)
against the pre-run snapshot. Roll back via the preflight snapshot copy
(`cp` it back over `src/pokehousing.sqlite`) if the operator rejects the delta.

**Potential renames are candidate-detect, operator-confirm, then CLI.** A sync
(or dry-run) report showing a DB entity whose name no longer appears anywhere in
the scrape **plus** a new incoming entity (often sharing the slug / dex number /
image path or other metadata) is the rename signature. When you spot one:
present the candidate `old → new` pair with the supporting evidence to the
operator and stop for confirmation — never act on a detected rename unilaterally.

After the operator confirms, execute with the rename CLI (never an SQL UPDATE,
never a hand edit of the DB):

```bash
npm run rename:entity -- --type <pokemon|item|habitat> --from "Old" --to "New" --dry-run
npm run rename:entity -- --type <pokemon|item|habitat> --from "Old" --to "New"   # records the tombstone row
npm run build:data   # bakes public/data/tombstones.json (oldName -> canonicalName)
npm run test:harvest # rerun the harvest suite incl. rename/skill tests
```

Record which tombstone rows the run created, and re-run the existing verify and
`e2e/legacy-hash.spec.ts` / `e2e/legacy-storage.spec.ts` steps before committing.
Deleted names **cannot** be tombstoned (there is no surviving entity to point
at): a top-level removal the operator requests remains an explicit **manual**
step, breaks old URL hashes/saved islands referencing the name, and can clash
with `e2e/fixtures/legacy-*.json` — fixture fallout is a **stop-and-ask**
condition, never a silent fixture regeneration.

## Harness notes

Edited or newly added skills take effect after `/daemon-reload`; validate the
file with `polytoken validate skill .polytoken/skills/pokopia_update/SKILL.md`.
A single invalid SKILL.md is skipped with a TUI warning — it does not break
other skills.
