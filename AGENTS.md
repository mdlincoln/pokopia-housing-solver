# AGENTS.md

This file provides guidance to LLM coding agents when working with code in this repository.

# Project

Pokopia Housing Solver — a browser-only Vue 3 SPA that optimizes cohousing assignments for Pokopia Pokémon using agglomerative clustering on a precomputed adjacency graph. There is no backend and no runtime SQL: `public/pokehousing.sqlite` remains the source of truth, but it is baked into static payloads at build time (`npm run build:data`) and the app ships zero WASM.

# Commands

```bash
npm run dev              # Vite dev server at http://localhost:5173
npm run build            # build:data bake, then type-check (vue-tsc) + vite build
npm run build:data       # bake src/data/*.json + public/data/adjacency.json from the sqlite DB
npm run preview          # serve the production bundle locally

npm run test:unit        # Vitest (jsdom) — src/__tests__/*.spec.ts
npm run test:e2e         # Playwright (Chromium); auto-starts dev or preview server
npx playwright install chromium   # first-run only

npm run lint             # oxlint --fix then eslint --fix --cache
npm run format           # oxfmt on src/ and scripts/
npm run check            # format + lint + type-check + unit + harvest tests (e2e is separate)
npm run test:harvest     # node:test regression suite (scripts/*.test.js)
```

Running a single test:

```bash
npx vitest run src/__tests__/solver.spec.ts                         # one unit file
npx vitest run src/__tests__/solver.spec.ts -t "greedyFillRemaining" # one test by name
npx playwright test e2e/vue.spec.ts -g "Saves title with query"     # one e2e by name
```

A pre-commit hook runs lint-staged (eslint + oxlint + oxfmt) on staged `.js`/`.ts`/`.vue` files.

# Data Maintenance

`scripts/harvest_pokemon.js` syncs the pokemon catalog in `public/pokehousing.sqlite` with Serebii's Pokopia PokéDex. It scrapes Serebii's list pages, compares case-insensitively against the DB, downloads sprite images to `public/images/`, and inserts any missing pokemon with their image path, ideal habitat, and favorites. Any Serebii favorites not present in the DB `favorites` table are flagged (not auto-inserted) for manual review.

```bash
npm run harvest:pokemon              # scrape + add missing pokemon
npm run harvest:pokemon -- --dry-run # report only, no DB/image writes
npm run harvest:pokemon -- --verify  # completeness + data-integrity check
npm run harvest:pokemon -- --delay 1.0  # raise base request delay (jittered to [delay, 3.0]s)
```

The script uses only the Node standard library (`fetch`, `node:sqlite`, `node:util`). It requests pages with a jittered delay to scrape politely. New form-variant pokemon use the Serebii image filename directly (e.g., `images/592-frillishmaleform.png`) rather than the legacy `images/<dex>.png` convention.

# Item Maintenance

`scripts/harvest_items.js` syncs the `items`, `item_favorites`, and `item_recipe` tables in `public/pokehousing.sqlite` with Serebii's Pokémon Pokopia item database. It scrapes all 43 favorites-category list pages and the comprehensive items listing to discover items and their favorite-category mappings, then fetches each missing item's detail page to extract metadata (category, tag, flavor text), crafting recipe (ingredients + counts), and favorite mappings. Item sprite images are downloaded to `public/images/`.

Recipes use a two-pass insertion approach: all new items are inserted first (Pass 1), then recipes and favorite mappings are inserted (Pass 2) referencing the newly created item IDs, ensuring foreign-key constraints on `item_recipe.ingredient_id` are satisfied. Existing items with incomplete favorite mappings are backfilled, and existing items lacking recipes (e.g., from a prior partial run) get their recipes backfilled on subsequent runs.

```bash
npm run harvest:items              # scrape + add missing items
npm run harvest:items -- --dry-run # report only, no DB/image writes
npm run harvest:items -- --verify  # completeness + data-integrity check
npm run harvest:items -- --delay 1.0  # raise base request delay (jittered to [delay, 3.0]s)
```

The script uses only the Node standard library (`fetch`, `node:sqlite`, `node:util`). Like `harvest_pokemon.js`, it requests pages with a jittered delay to scrape politely. The DB `picture_path` follows the convention `images/<slug>.png`, where `<slug>` matches the Serebii detail-page URL slug.

`node:sqlite` is experimental and requires **Node 22+** (`.nvmrc` pins `22.22.2`); it prints a harmless `ExperimentalWarning`.

**After any harvest, re-run `npm run build:data`** to regenerate the baked payloads (`src/data/*.json`, `public/data/adjacency.json`) and commit them together with the DB. The full workflow is: harvest (writes sqlite) → `npm run build:data` (bakes static payloads) → build/test.

Any harvest that adds or renames a **favorite** or **habitat** must also add the corresponding icon mapping (`src/favoriteIcons.ts`, `src/habitats.ts` `HABITAT_ICONS`) **and** its `?raw` SVG import in `src/iconSvg.ts`; `src/__tests__/favoriteIcons.spec.ts` fails until both are added.

Unit tests live in `scripts/harvest_items.test.js` and `scripts/harvest_pokemon.test.js` and use Node's built-in `node:test` (no extra dependencies). Run with:

```bash
npm run test:harvest
```

# Architecture

## Data layer

`public/pokehousing.sqlite` is the source of truth, but no SQL or WASM runs in the browser. `scripts/build_data.mjs` (`npm run build:data`, Node 22+ `node:sqlite`, stdlib only) reads the DB at build time and emits three denormalized payloads:

- `src/data/pokemon.json` — `{ names: string[] (sorted), dataByName }`; bundled by Vite.
- `src/data/items.json` — the item-graph shape (`itemDetailsByName`, `itemsByFavorite`, `favoritesByItem`, `recipeByItem`); bundled by Vite. **Key insertion order is load-bearing** — it mirrors the generator's SQL `ORDER BY` and drives recommendation/aggregation ordering; never re-sort at runtime.
- `public/data/adjacency.json` — `{ names, size, data }` where `data` is base64 of a dense `Int16Array(N×N)` keyed by pokemon id: `-1` = hard exclusion (opposite habitat axis), `0` = no edge, `>0` = score. Fetched once at runtime (kept out of the JS bundle).

The generated files are **committed**; `scripts/build_data.test.js` asserts they stay in sync with the generator output (re-run `npm run build:data` after any harvest). `src/data/index.ts` loads them: pokemon/items via bundled import, adjacency via one `fetch` decoded into the flat `AdjacencyData` (`{ names, indexByName, size, matrix }`) that is cheap to structured-clone to the solver worker. Production assets are served under `/pokopia-housing-solver/`; `src/assetPath.ts` wraps `import.meta.env.BASE_URL` so the adjacency fetch works in both dev and prod.

**`src/queries.ts` is the only module that reads the baked data** (via `src/data/index.ts`) — never import `src/data/*` from components or other modules. The DB schema lives in `scripts/db.sql`. Key tables:

- `pokemon`, `pokemon_favorites`, `favorites`, `habitats` — pokemon catalog and their favorite items, plus habitat axes.
- `items`, `item_favorites`, `item_recipe` — item catalog, which favorites each fulfills, and crafting recipes.
- `items.tag` — Pokopia item tags (`Relaxation`, `Toy`, `Decoration`) used to filter recommendations.
- `adjacency` — precomputed pairwise pokemon compatibility scores (shared favorites + habitat bonuses, `null` for opposite-axis exclusions).

Exported query helpers include `loadPokemonNames`, `loadPokemonData(names?)` (hydrate lazily for the currently selected set only), `loadAdjacencyMap`, `favoritesForItem`, `recommendedItemsForHouse` (favorites-only, parity-pinned; one boolean `fav_<favorite>` key per distinct input favorite), `recommendedItemsForHouseAllNeeds` (tag-aware retention/ordering — see the HouseRecord bullet), `getItemMetadata`, `getItemPicturePath`, `getRecipeForItem`, and `getAggregatedIngredients`.

All item-facing helpers (`favoritesForItem`, `recommendedItemsForHouse`, `getItemMetadata`, `getItemPicturePath`, `getRecipeForItem`, `getAggregatedIngredients`) are pure in-memory lookups over a once-hydrated item graph: `loadItemGraph()` converts the bundled `items.json` into Map-based structures on first use and is shared via a cached promise (the whole item domain is ~1700 rows). HomeView pre-warms it on mount (`void loadItemGraph()`) alongside the names/adjacency loads. The graph reuses shared object references, so helpers that hand data to stores copy small results (`getRecipeForItem` deep-copies its recipe arrays; `recommendedItemsForHouse` builds fresh row objects).

## Solver (`src/solver.ts`)

Exports a single `solve()` function that assigns pokemon to houses using a three-phase clustering pipeline. Pokemon names are sorted alphabetically at the top of `solve()` so output is deterministic regardless of input order.

Houses have fixed capacities: small=1, medium=2, large=4, each with a stable string ID like `S1`, `M2`, `L1`.

**Habitat compatibility.** Three axes — light (`Dark`/`Bright`), temperature (`Cool`/`Warm`), moisture (`Dry`/`Humid`). Same habitat value = +1 bonus; **opposite ends of the same axis = hard exclusion** (pair cannot cohabitate and is removed from clustering/matching/greedy-fill entirely). In the baked `AdjacencyData` matrix exclusions are stored as a `-1` sentinel and decoded back to `null` by `buildSubMatrix` / `getScore`. Different axes = no effect.

**Pipeline** (executed in order, each phase operating on pokemon left by the previous):

1. **Phase 1 — `agglomerativeCluster4`** fills large houses via hierarchical agglomerative clustering with average-linkage, capped at size 4. Large houses have 6 internal pairwise edges so clustering matters most. Clusters that hit size 4 are ranked by total internal weight.
2. **Phase 2 — `greedyMaxWeightMatching`** fills medium houses. With only one internal edge, this reduces to max-weight matching; greedy (sort edges by weight, pick non-overlapping) is near-optimal.
3. **Phase 3 — `greedyFillRemaining`** handles small houses, any remaining slots, and the whole assignment when no `adjacencyMap` is provided. Picks the (pokemon, house) pair with highest total affinity to existing occupants; rejects houses where any occupant has a negative/null adjacency.

`buildSubMatrix` extracts an N×N matrix for the selected pokemon from the global adjacency data (preserving `null` entries) so clustering operates on local indices rather than the full ~150-pokemon catalog.

**Pinned assignments.** When `pinnedAssignments` (a `Map<houseId, pokemonNames[]>`) is provided, pinned pokemon are pre-placed before clustering. A **pin-complement fill** step then fills the rest of each partially-occupied pinned house (empty houses are temporarily hidden) via `greedyFillRemaining` restricted to those houses — this ensures free pokemon pair by affinity to the pinned resident rather than each other, and prevents partial large houses from being misclassified as medium by the clustering phases. Only then does `clusterPreAssign` run on the remaining free pokemon and empty houses.

**Helpers:** `enumerateHouses(config)` flattens a `HousingConfig` into an ordered list. `countSharedFavorites(a, b)` is the fallback scoring function used by `greedyFillRemaining` when no adjacency is available.

## Solver client / Web Worker

HomeView invokes the solver through `src/solverClient.ts#solveInWorker`, never `solve()` directly. The client:

- lazily spawns the worker at `src/solver.worker.ts` and tracks pending requests by monotonic id;
- **supersedes any in-flight request** by rejecting its promise with `SupersededError` when a new one arrives (e.g. rapid pin toggles) — callers should swallow this rejection silently; the worker response for the old request is dropped on arrival;
- strips Vue reactivity with `toRaw` + explicit copying before `postMessage`. Reactive Proxies are not structured-clonable, and `{ ...pokemonData.value }` spreads leave sub-objects reactive, so the client rebuilds each argument as plain JS values;
- falls back to synchronous `solve()` on the main thread when `Worker` is undefined (jsdom unit tests).

## UI (`src/views/HomeView.vue` + components)

Vue 3 + Pinia + Bootstrap Vue Next. `src/main.ts` wires Bootstrap CSS/Icons, `bootstrap-vue-next`, Pinia, the single-route router (`/` → HomeView), `posthog-js` (errors piped to `captureException` via `app.config.errorHandler`), and the pastel theme in `src/styles/tropical-theme.css`.

**Reactive solve.** The app shell is a full-width fluid container (`.app-shell`, no fixed `max-width`) that fills the flex space beside the 300px inline shopping-cart sidebar. A full-width "Not sure where to start?" alert (`sample-island-alert`) with a "Show a sample island" button sits between the intro hero and the config row. The top of HomeView renders as a three-card row that splits at `xl` (1200px) — the house-count card (`houses-card`), the pokemon-search card (`pokemon-search-card`), and the island save/restore card (`islands-card`) — stacking vertically below `xl`; all three carry the shared `.top-gradient-card` / `.islands-card` gradient header. Users configure house counts via `BFormSpinbutton` and select pokemon via the autocomplete `PokemonSelect`. Results update automatically via a `watch` — no submit button. The watch flips `solving=true` immediately (so the spinner appears without delay), then runs a 150ms trailing-edge debounce (`src/utils/debounce.ts`) before calling `solveInWorker`, collapsing bursts of rapid interactions into a single run.

**Lazy hydration.** On mount HomeView calls `loadPokemonNames()` and `loadAdjacencyMap()` once, and pre-warms the item graph with a fire-and-forget `loadItemGraph()`. `loadPokemonData(selectedNames)` hydrates image/favorites/habitat only for the currently selected pokemon; entries are removed locally when deselected.

**Results.** A `TransitionGroup` renders one `HouseRecord` per assigned house; pinned houses sort to the bottom with a 750ms FLIP transition. Unhoused pokemon and errors appear in `BAlert` banners. While solving, the list carries a `results-pending` class (60% opacity, pointer-events disabled); the previous `result` is kept visible across solves so houses fade rather than flashing out.

**Clear all / Show a sample island.** The houses card ("Clear all") and pokemon card ("Clear all") each reset only their own concern: the houses button sets small/medium/large to 0, the pokemon button clears `selectedPokemon` (and its hydrated data) — neither touches the other card's state. The full-width "Show a sample island" alert prefills 1 small / 3 medium / 2 large and 13 random pokemon (shown once the names catalog loads); it also clears pins/progress/registry before loading.

**Saved queries** (`localStorage` key `pokehousing_saved_queries`). `SavedQuery` entries include `title`, `timestamp`, `small/medium/large`, `pokemon`, optional `cart: { houseId?, name }[]`, optional `checkedCartItems`, optional `placedItems`, and (v2+) `pinnedHouses`, `pinnedPokemon`, `houseRegistry`, `houseCounters`. **Restore paths must be tolerant of missing fields on older entries** (legacy entries may carry `houseIndex` instead of `houseId`, or `quantity` which is accepted and ignored). A `BModal` prompts for an optional title (focused on `@shown`); success alert shows for 3s. The save modal submits on Enter in the title input (`onSaveEnter` = `confirmSave` + close; the modal `@ok` handler covers button clicks). **User-facing copy uses "island" vocabulary** (e.g. "Save island", "Saved islands") — internal names (`SavedQuery`, `#saved-queries-select`, the localStorage key) stay unchanged for legacy compatibility. A "Manage saved islands" button besides the restore select opens a modal with per-row Delete buttons; deletions persist immediately but stashe the entry for an 8-second single-slot Undo window (`deleteSaved`/`undoDelete`, timer cleared on unmount).

**URL sharing.** All scenario state is reactively encoded into the URL hash as base64 JSON via `history.replaceState`. A `restoringFromUrl` flag suppresses the hash watcher during import. Visitors landing on a hash URL get the state restored via `onMounted` without touching localStorage.

**Legacy hash compatibility guarantee.** A URL hash has no expiry: a hash produced by any historical commit — including the pre-refactor sql.js build (`c016616…`, which queried `public/pokehousing.sqlite` at runtime) — must keep loading in the current baked-data build. The `SharedState` contract is unchanged, so the only failure mode is *name drift*: a pokemon name, cart item name, or `houseId:name` key in `pinnedPokemon`/`checkedCartItems`/`placedItems` recorded in an old hash that no longer resolves in `src/data/pokemon.json` / `src/data/items.json`. The contract is encoded by `scripts/legacy_compat.test.js` (fast node:test name-resolution + hash round-trip guard) plus the committed `e2e/fixtures/legacy-island.json` fixture (a genuine c016616 hash with 13 pokemon and ≥3 cart items) exercised end-to-end by `e2e/legacy-hash.spec.ts`. Any harvest that renames or removes an identifier must keep these fixtures/tests green, or update them deliberately as part of the same change.

**Legacy saved-query compatibility guarantee.** The saved-query (localStorage) path is guarded by the same contract. `localStorage['pokehousing_saved_queries']` is `JSON.stringify(SavedQuery[])` — a plain, non-base64 JSON **array** of entries, each sharing the same v2 `SharedState` body (`title`/`timestamp` + the `toSerializable` fields). Unlike the URL-hash path (base64 + `onMounted`), a saved query restores via the `#saved-queries-select` dropdown (`selectedTimestamp` watch → `restoreState`), read by `loadSavedQueries()` with a `JSON.parse(... ?? '[]')` try/catch. The contract is encoded by `scripts/legacy_storage_compat.test.js` (fast node:test name-resolution + storage round-trip guard) plus the committed `e2e/fixtures/legacy-saved-query.json` fixture (a genuine c016616 localStorage string with 13 pokemon and ≥3 cart items) exercised end-to-end by `e2e/legacy-storage.spec.ts`. Any harvest that renames or removes an identifier must keep these fixtures/tests green, or update them deliberately as part of the same change.

**Loading indicators.** Three surfaces cover the slow moments: (1) `index.html` inlines a static splash (`.app-splash`, pure-CSS keyframe spinner, `role="status"`) inside `#app` — it paints before any JS runs and is replaced when Vue mounts; its colors hardcode the theme constants and may drift if `tropical-theme.css` changes. (2) HomeView gates its config/results chrome behind a `catalogReady` ref (set at the end of `onMounted`, covering URL-hash restores) plus a `restoringQuery` ref (set around saved-query restores from localStorage); while gated, a centered `catalog-loading` spinner is shown instead. (3) The cart store wraps `addItem`/`removeItem`/`restoreItems`/`clearCart` in a `withBusy` pending-mutation counter exposed as `busy`; App.vue shows a fixed `cart-busy-overlay` only after 150ms of sustained busy (flicker guard) with `pointer-events: none` so it never blocks clicks (required for Playwright tests — do not make the overlay interactive).

**Pinning** (owned by `src/stores/pins.ts`). Each house card has a `progress-checkbox-house` lock button; each pokemon card has `progress-checkbox-pokemon`. Both keep `role="checkbox"` + `aria-checked` semantics (e2e depends on them) and carry state-aware `aria-label`s ("Pin this house (L1)…" / "Unpin house L1", "Pin {name} to this house" / "Unpin {name}"). Icons: `bi-lock-fill` when pinned, `bi-unlock` when not. Pinning a house pins all its current occupants AND prevents the house from being removed when reducing counts. Pinned pokemon have disabled close buttons in `PokemonSelect`. House count `:min` values are computed from pinned counts per size so reductions are clamped.

## Pinia stores

- `src/stores/houses.ts` — House Registry. Each house gets a stable string ID `S1`/`M2`/`L1` (size prefix + monotonic per-size counter). IDs never get reused. `reconcileHouses(config, pinnedHouseIds)` adds/removes houses to match desired counts, never removing pinned ones (removes highest-counter unlocked first). `orderedHouses` sorts large → medium → small, then by counter.
- `src/stores/pins.ts` — Pin store. State: `pinnedHouses: Set<string>`, `pinnedPokemon: Set<string>` (keys `"houseId:pokemonName"`). `pinHouse(houseId, occupants)` pins the house AND all its current occupants; `unpinHouse` only unpins the house. `getPinnedAssignments()` returns `Map<houseId, pokemonNames[]>` for the solver. Computed: `effectivelyPinnedHouseIds` (explicit OR has pinned pokemon), `allPinnedPokemonNames`.
- `src/stores/cart.ts` — Cart store. `items: Map<"houseId:itemName", CartEntry>` (no quantity — each house/item pair is unique; the same item in multiple houses counts independently). `addItem(houseId, name)` is idempotent; loads picture, metadata, and recipe via queries, then recomputes aggregated ingredients. `restoreItems` accepts legacy `houseIndex`/`quantity` shapes. Getter `itemsByHouse` maintains stable per-house array references via a `name,...` fingerprint so unaffected `HouseRecord` watchers skip deep comparisons.
- `src/stores/progress.ts` — Progress store. `checkedCartItems` (crafted) and `placedItems` (placed-in-house), both `Set<"houseId:itemName">`. Crafted items are excluded from the cart's aggregated ingredient totals. `clearItemProgress(houseId, name)` is called by `cartStore.removeItem` so re-adding starts fresh.

## Components

- `src/components/HouseRecord.vue` — house card. Shows size/capacity, PokemonCards, and a single collapsible recommendations `<details>` panel gated on the merged candidate list (base recommendations **and** added cart items). The former separate "Items in cart" coverage table has been folded into this table: added items render inline with an "Added" `BBadge` (`recommendation-added-badge`), a subtle `recommendation-added-row` background tint, and sort above unadded rows; the action rail (add-to-cart `+` / `recommendation-remove`) and the safe **Placed** toggle (`recommendation-placed`) lead the left side in their own `col_actions` and `col_placed` columns (so the two never share a cell or tap area and stay reachable despite the wide table). All house-favorite columns and all tag columns (Toy / Relaxation / Decoration) are always shown (fulfilled ones render with a green header, never removed); an unadded row's coverage of an already-fulfilled favorite, and an unadded row's tag cell once that tag is already fulfilled, are grayed out (`table-secondary`) to signal they are lower value, while added rows keep the full success highlight. The table re-ranks whenever the active sort favorite becomes fulfilled so ordering reflects only needs yet to be fulfilled. Each favorite-coverage ✓ cell carries a hover `title`: a placed (in-cart) item reads "{name} is fulfilling {need}", an unadded item covering a still-unfulfilled need reads "{name} could fulfill {need} if it were placed in this house", and an unadded item covering an already-fulfilled need (the grayed cell) reads "{name} would fulfill {need}, but it is fulfilled by other items already placed in this house." The table paginates: at most 50 rows render initially and a footer (`recommendations-more`) appends the next 50 per click; rows key on `primary-key="name"` so appending never recreates already-visible DOM nodes. Recommendation rows are now tag-aware: they come from `recommendedItemsForHouseAllNeeds` (retaining an item when its item type — Toy / Relaxation / Decoration — is still unmet in the house even if all its favorites are fulfilled, and counting unfulfilled tags toward ordering), while still limited to the tagged Relaxation/Decoration/Toy set; `recommendedItemsForHouse` remains favorites-only and parity-pinned. The table keeps vertical-rotated headers (`.recommended-items-table`) and one boolean `bool-col` per tag / favorite. A `+` button (`add-to-cart`) adds unadded items to that house's cart. The table renders lazily: it mounts only after the panel is first opened (a `hasOpenedRecs` latch on the `<details>` toggle) and stays mounted afterwards. The `fulfilledFavorites` set keeps its reference stable across watch re-runs with unchanged contents (`sameFavorites` comparison) so PokemonCards don't re-render on no-op cart interactions.
- `src/components/PokemonCard.vue` — horizontal card (`no-body`) with image + name + habitat pill (`habitat-badge`, static, exact appearance unchanged) + a per-favorite needs table (`pokemon-favorites-table`) rendered as a full-width, flush direct child of the card below the image/info row. The table's name column is a native `<button>` (`fave-badge`) that re-emits `favoriteClicked` so HouseRecord can open its recommendations panel sorted by that favorite's column; the centered `bool-col` shows a conditional `.bool-check` ✓ only when the favorite is fulfilled by a cart item.
- `src/components/PokemonSelect.vue` — autocomplete multi-select with ARIA combobox semantics (`role="combobox"`, `aria-expanded`/`aria-controls`/`aria-activedescendant`, a `role="listbox"` dropdown, and a polite live region announcing match counts). Accepts `pinnedNames: Set<string>` to disable close buttons for pinned entries.
- `src/components/HousesConfigCard.vue`, `src/components/PokemonConfigCard.vue`, `src/components/SavedIslandsCard.vue` — the three top configuration cards (house counts / pokemon search / saved islands). Each is its own component with a shared `.config-card-header` (title on the left, the card's primary action button on the right, identical padding across all three) and the unified `.shell-card-body` density; all state and handlers live in `HomeView` (passed via props/emits) so HomeView's `defineExpose` surface stays the same.
- `src/components/ShoppingCart.vue` — `BOffcanvas` panel mounted in `App.vue` alongside main content in a flex row, controlled by `:model-value="isBelowLg ? showMobileCart : true"` so desktop inline rendering is untouched while the below-lg overlay is openable. `:body-scrolling="!isBelowLg"` prevents the BOffcanvas scroll-lock from trapping body `overflow: hidden` at desktop (where the cart renders inline, not as an overlay). `responsive="lg"` — sticky inline sidebar at ≥992px, sliding overlay below; below lg a fixed-position `cart-mobile-toggle` button (`d-lg-none`, count badge, `aria-expanded`/`aria-controls`) opens it, hiding while the overlay is open. Groups whose house id is no longer in the house registry keep their items and show a `cart-orphan-note` annotation (`cart-house-group--orphan` styling) instead of being auto-deleted. Items grouped by house (`cart-house-group`). Each cart item has a **🔨 Crafted** stamp (`progress-checkbox-cart-item`) which strikes through the name and removes its ingredients from aggregated totals. Each cart item and added-row remove control is the shared quiet `.item-remove` close button (`BCloseButton`), matching the pokemon-chip ✕ convention and recoloring the ✕ glyph to solid danger on hover/focus; only "Clear all" (`cart-clear`) keeps the loud `outline-danger` look as the app's single destructive action. Aggregated ingredient totals listed below all groups. Colors from `tropical-theme.css`.
- Habitat → badge-variant map is the shared `HABITAT_VARIANT` constant in `src/habitats.ts`.
- PokemonCard's habitat badge (`habitat-badge`) and favorites table (`fave-badge`) plus HouseRecord's recommendation-table favorite column headers (`fav-header-*`) render a **decorative inline SVG glyph** next to each favorite/habitat name through `src/components/IconGlyph.vue`, backed by `src/iconSvg.ts` (Vite `?raw` imports of the ~49 referenced glyphs). The glyph-to-name mappings live in `src/favoriteIcons.ts` (`FAVORITE_ICONS`) and `src/habitats.ts` (`HABITAT_ICONS`). Glyphs are `aria-hidden="true"` (accessible names come from the surrounding visible text) and styled by the `.icon-glyph` utility in `tropical-theme.css` (1em scaling, exempt from the recommendation header's vertical-rotation transform).

**Test selectors.** Tests key off `data-testid` attributes, not Bootstrap classes. Known IDs include: `house-card`, `error`, `unhoused`, `empty`, `results`, `habitat-badge`, `fave-badge`, `shopping-cart`, `cart-empty`, `cart-items`, `cart-item`, `cart-remove`, `cart-clear`, `cart-aggregated`, `cart-aggregated-item`, `add-to-cart`, `item-name`, `item-craftability`, `item-craftable-badge`, `item-category-badge`, `recommended-items`, `recommended-items-list`, `recommendations-more`, `craftable-only-toggle`, `recommendation-added-badge`, `recommendation-remove`, `recommendation-placed`, `progress-checkbox-house`, `progress-checkbox-pokemon`, `progress-checkbox-cart-item`, `progress-checkbox-placed-item`, `cart-house-group`, `cart-tag-toy`, `cart-tag-relaxation`, `cart-tag-decoration`, `catalog-loading`, `cart-busy-overlay`, `saved-queries-manage`, `saved-queries-modal`, `saved-query-delete`, `saved-query-deleted`, `saved-query-undo`, `houses-card`, `pokemon-search-card`, `sample-island-alert`, `islands-card`, and dynamic `fav-header-fav_<favorite>` plus `tag-header-<col_toy|col_relaxation|col_decoration>`, `cart-mobile-toggle`, `cart-orphan-note`, and `pokemon-search-status`. Add new IDs when introducing testable UI.

**Accessibility conventions.** Interactive icon/pill controls meet the WCAG 2.5.8 minimum tap target of 24×24 CSS px (`min-width`/`min-height` in `tropical-theme.css`, enforced by e2e bounding-box assertions at desktop and mobile widths, including the add-to-cart control). Cart item remove and coverage remove controls are `.item-remove` close buttons, also covered by those bounding-box tap-target assertions in `e2e/vue.spec.ts`. Visually empty table headers (e.g. `col_image`/`col_actions`) carry `span.visually-hidden` screen-reader names. Viewport-height sizing uses `100dvh` with a `100vh` fallback declared first (source order = fallback), pinned by `scripts/theme_units.test.js`. The document outline runs h1 hero → h2 section/card titles → h3 house/alert titles → h4 Pokémon names (cart dialog: h2 title → h3 sections; modals: h2 titles) — new sections pick the level that continues the outline. Decorative pseudo-glyphs (`.section-heading::before`, `.house-title::after`) must use the `content: glyph / ''` alt-text syntax so they stay out of accessible names. Reduced-motion gating, contrast floors, and pseudo-glyph alt text are pinned by `scripts/theme_a11y.test.js`.

**Compact density conventions.** The app is mobile-first and high-density: `e2e/compactness.spec.ts` asserts no horizontal overflow at 390px (including with a hydrated results table open) and pins component paddings at both viewport tiers. All spacing flows from the compact `--space-1..5` ramp (`0.25/0.5/0.75/1/1.5rem`, pinned exactly by `scripts/theme_tokens.test.js`) — components compose these tokens rather than introducing one-off rem values, and radii come from `--trop-radius-card|control|alert|pill`. **Density lives in `tropical-theme.css`; templates carry structural utilities only** (`d-flex`, `gap-*`, `h-100`, etc.) — spacing/padding utilities like `py-*`/`p-*`/`mb-*` are replaced by themed classes (`.app-shell`, `.shell-card-body`, `.page-hero`, …). The mobile density tier is a single `@media (max-width: 767.98px)` block aligned with Bootstrap's `md` breakpoint. Buttons share one pill recipe: components opt in with `.beach-button` (+ the `.beach-button--sm` size knob), and modal footer buttons inherit it positionally via the `:is(.beach-button, .modal-footer .btn)` merge — do not add per-modal button CSS. Collapsed disclosures share the `.details-summary` pattern (HouseRecord's recommendations keep their positional selector). Pokemon cards render in a wrapping `.pokemon-grid` (one per row on phones), not Bootstrap's non-wrapping `BCardGroup`.

## Tests

- Unit: `src/__tests__/*.spec.ts` under Vitest + jsdom, using `@vue/test-utils`.
- E2E: `e2e/*.spec.ts` under Playwright (Chromium only). `playwright.config.ts` runs `npm run dev` locally (port 5173) or `npm run preview` on CI (port 4173). Timeout 5s per test, 2s per expect.

When inspecting the running app with Playwright, always clean up any screenshots you capture (e.g. `page.screenshot(...)` output) before finishing — delete them along with any `.playwright-mcp/` artifacts so they never get committed or left behind.

## Deployment

GitHub Actions builds on push to `main` (installs Node from `.nvmrc`, runs `npm ci && npm run build`). Production assets are published from `dist/` to the `web` branch under `/pokopia-housing-solver/`. The Vite `base` and Vue Router `history` both key off `import.meta.env.BASE_URL` so route and asset paths stay aligned.

# Credits

Original data collection is from https://pokopia-roommate-matchmaker.netlify.app/ and https://github.com/JEschete/PokopiaPlanning.
