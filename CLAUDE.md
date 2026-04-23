# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Project

Pokopia Housing Solver — a browser-only Vue 3 SPA that optimizes cohousing assignments for Pokopia Pokémon using agglomerative clustering on a precomputed adjacency graph. There is no backend: all data lives in `public/pokehousing.sqlite` and is queried in-browser via `sql.js` (WASM).

# Commands

```bash
npm run dev              # Vite dev server at http://localhost:5173
npm run build            # type-check (vue-tsc) + vite build
npm run preview          # serve the production bundle locally

npm run test:unit        # Vitest (jsdom) — src/__tests__/*.spec.ts
npm run test:e2e         # Playwright (Chromium); auto-starts dev or preview server
npx playwright install chromium   # first-run only

npm run lint             # oxlint --fix then eslint --fix --cache
npm run format           # oxfmt on src/
npm run check            # format + lint + type-check + unit + e2e (the full gate)
```

Running a single test:

```bash
npx vitest run src/__tests__/solver.spec.ts                         # one unit file
npx vitest run src/__tests__/solver.spec.ts -t "greedyFillRemaining" # one test by name
npx playwright test e2e/vue.spec.ts -g "Saves title with query"     # one e2e by name
```

A pre-commit hook runs lint-staged (eslint + oxlint + oxfmt) on staged `.js`/`.ts`/`.vue` files.

# Architecture

## Data layer

`public/pokehousing.sqlite` is loaded once into `sql.js` (`src/db.ts#getDb`) on first use. The WASM binary is served by a Vite middleware from `node_modules/sql.js/dist/sql-wasm.wasm` in dev and copied to `dist/wasm/` at build time (see `vite.config.ts`). Production assets are served under `/pokopia-housing-solver/`; `src/assetPath.ts` wraps `import.meta.env.BASE_URL` so fetches work in both dev and prod.

**`src/queries.ts` is the only module that calls `db.exec()`.** All SQL is centralized there — never write inline SQL in components or other modules. The schema lives in `scripts/db.sql`. Key tables:

- `pokemon`, `pokemon_favorites`, `favorites`, `habitats` — pokemon catalog and their favorite items, plus habitat axes.
- `items`, `item_favorites`, `item_recipe` — item catalog, which favorites each fulfills, and crafting recipes.
- `items.tag` — Pokopia item tags (`Relaxation`, `Toy`, `Decoration`) used to filter recommendations.
- `adjacency` — precomputed pairwise pokemon compatibility scores (shared favorites + habitat bonuses, `null` for opposite-axis exclusions).

Exported query helpers include `loadPokemonNames`, `loadPokemonData(names?)` (hydrate lazily for the currently selected set only), `loadAdjacencyMap`, `itemsForFavorite`, `favoritesForItem` (cached), `idealItems`, `recommendedItemsForHouse` (builds a dynamic SELECT with one `MAX(CASE ...) AS "fav_<favorite>"` column per distinct favorite), `getItemMetadata`, `getItemPicturePath`, `getRecipeForItem`, and `getAggregatedIngredients`.

## Solver (`src/solver.ts`)

Exports a single `solve()` function that assigns pokemon to houses using a three-phase clustering pipeline. Pokemon names are sorted alphabetically at the top of `solve()` so output is deterministic regardless of input order.

Houses have fixed capacities: small=1, medium=2, large=4, each with a stable string ID like `S1`, `M2`, `L1`.

**Habitat compatibility.** Three axes — light (`Dark`/`Bright`), temperature (`Cool`/`Warm`), moisture (`Dry`/`Humid`). Same habitat value = +1 bonus; **opposite ends of the same axis = `null`** in the adjacency map (hard exclusion — pair cannot cohabitate and is removed from clustering/matching/greedy-fill entirely). Different axes = no effect.

**Pipeline** (executed in order, each phase operating on pokemon left by the previous):

1. **Phase 1 — `agglomerativeCluster4`** fills large houses via hierarchical agglomerative clustering with average-linkage, capped at size 4. Large houses have 6 internal pairwise edges so clustering matters most. Clusters that hit size 4 are ranked by total internal weight.
2. **Phase 2 — `greedyMaxWeightMatching`** fills medium houses. With only one internal edge, this reduces to max-weight matching; greedy (sort edges by weight, pick non-overlapping) is near-optimal.
3. **Phase 3 — `greedyFillRemaining`** handles small houses, any remaining slots, and the whole assignment when no `adjacencyMap` is provided. Picks the (pokemon, house) pair with highest total affinity to existing occupants; rejects houses where any occupant has a negative/null adjacency.

`buildSubMatrix` extracts an N×N matrix for the selected pokemon from the global adjacency data (preserving `null` entries) so clustering operates on local indices rather than the full ~150-pokemon catalog.

**Pinned assignments.** When `pinnedAssignments` (a `Map<houseId, pokemonNames[]>`) is provided, pinned pokemon are pre-placed before clustering. A **pin-complement fill** step then fills the rest of each partially-occupied pinned house (empty houses are temporarily hidden) via `greedyFillRemaining` restricted to those houses — this ensures free pokemon pair by affinity to the pinned resident rather than each other, and prevents partial large houses from being misclassified as medium by the clustering phases. Only then does `clusterPreAssign` run on the remaining free pokemon and empty houses.

**Helpers:** `enumerateHouses(config)` flattens a `HousingConfig` into an ordered list. `countSharedFavorites(a, b)` is the fallback scoring function used by `greedyFillRemaining` when no adjacency is available. `rankHouseFavorites(favoriteSets)` returns favorites shared by ≥2 pokemon in a house, used by the UI.

## Solver client / Web Worker

HomeView invokes the solver through `src/solverClient.ts#solveInWorker`, never `solve()` directly. The client:

- lazily spawns the worker at `src/solver.worker.ts` and tracks pending requests by monotonic id;
- **supersedes any in-flight request** by rejecting its promise with `SupersededError` when a new one arrives (e.g. rapid pin toggles) — callers should swallow this rejection silently; the worker response for the old request is dropped on arrival;
- strips Vue reactivity with `toRaw` + explicit copying before `postMessage`. Reactive Proxies are not structured-clonable, and `{ ...pokemonData.value }` spreads leave sub-objects reactive, so the client rebuilds each argument as plain JS values;
- falls back to synchronous `solve()` on the main thread when `Worker` is undefined (jsdom unit tests).

## UI (`src/views/HomeView.vue` + components)

Vue 3 + Pinia + Bootstrap Vue Next. `src/main.ts` wires Bootstrap CSS/Icons, `bootstrap-vue-next`, Pinia, the single-route router (`/` → HomeView), `posthog-js` (errors piped to `captureException` via `app.config.errorHandler`), and the pastel theme in `src/styles/tropical-theme.css`.

**Reactive solve.** Users configure house counts via `BFormSpinbutton` and select pokemon via the autocomplete `PokemonSelect`. Results update automatically via a `watch` — no submit button. The watch flips `solving=true` immediately (so the spinner appears without delay), then runs a 150ms trailing-edge debounce (`src/utils/debounce.ts`) before calling `solveInWorker`, collapsing bursts of rapid interactions into a single run.

**Lazy hydration.** On mount HomeView calls `loadPokemonNames()` and `loadAdjacencyMap()` once. `loadPokemonData(selectedNames)` hydrates image/favorites/habitat only for the currently selected pokemon; entries are removed locally when deselected.

**Results.** A `TransitionGroup` renders one `HouseRecord` per assigned house; pinned houses sort to the bottom with a 750ms FLIP transition. Unhoused pokemon and errors appear in `BAlert` banners. While solving, the list carries a `results-pending` class (60% opacity, pointer-events disabled); the previous `result` is kept visible across solves so houses fade rather than flashing out.

**Clear all / Show a sample island.** "Clear all" resets house counts, pokemon, pins, progress, and house registry to blank. "Show a sample island" prefills 1 small / 3 medium / 2 large and 13 random pokemon (disabled until the names catalog loads); it also clears pins/progress/registry before loading.

**Saved queries** (`localStorage` key `pokehousing_saved_queries`). `SavedQuery` entries include `title`, `timestamp`, `small/medium/large`, `pokemon`, optional `cart: { houseId?, name }[]`, optional `checkedCartItems`, optional `placedItems`, and (v2+) `pinnedHouses`, `pinnedPokemon`, `houseRegistry`, `houseCounters`. **Restore paths must be tolerant of missing fields on older entries** (legacy entries may carry `houseIndex` instead of `houseId`, or `quantity` which is accepted and ignored). A `BModal` prompts for an optional title (focused on `@shown`); success alert shows for 3s.

**URL sharing.** All scenario state is reactively encoded into the URL hash as base64 JSON via `history.replaceState`. A `restoringFromUrl` flag suppresses the hash watcher during import. Visitors landing on a hash URL get the state restored via `onMounted` without touching localStorage.

**Pinning** (owned by `src/stores/pins.ts`). Each house card has a `progress-checkbox-house` lock button; each pokemon card has `progress-checkbox-pokemon`. Icons: `bi-lock-fill` when pinned, `bi-unlock` when not. Pinning a house pins all its current occupants AND prevents the house from being removed when reducing counts. Pinned pokemon have disabled close buttons in `PokemonSelect`. House count `:min` values are computed from pinned counts per size so reductions are clamped.

## Pinia stores

- `src/stores/houses.ts` — House Registry. Each house gets a stable string ID `S1`/`M2`/`L1` (size prefix + monotonic per-size counter). IDs never get reused. `reconcileHouses(config, pinnedHouseIds)` adds/removes houses to match desired counts, never removing pinned ones (removes highest-counter unlocked first). `orderedHouses` sorts large → medium → small, then by counter.
- `src/stores/pins.ts` — Pin store. State: `pinnedHouses: Set<string>`, `pinnedPokemon: Set<string>` (keys `"houseId:pokemonName"`). `pinHouse(houseId, occupants)` pins the house AND all its current occupants; `unpinHouse` only unpins the house. `getPinnedAssignments()` returns `Map<houseId, pokemonNames[]>` for the solver. Computed: `effectivelyPinnedHouseIds` (explicit OR has pinned pokemon), `allPinnedPokemonNames`.
- `src/stores/cart.ts` — Cart store. `items: Map<"houseId:itemName", CartEntry>` (no quantity — each house/item pair is unique; the same item in multiple houses counts independently). `addItem(houseId, name)` is idempotent; loads picture, metadata, and recipe via queries, then recomputes aggregated ingredients. `restoreItems` accepts legacy `houseIndex`/`quantity` shapes. Getter `itemsByHouse` maintains stable per-house array references via a `name,...` fingerprint so unaffected `HouseRecord` watchers skip deep comparisons.
- `src/stores/progress.ts` — Progress store. `checkedCartItems` (crafted) and `placedItems` (placed-in-house), both `Set<"houseId:itemName">`. Crafted items are excluded from the cart's aggregated ingredient totals. `clearItemProgress(houseId, name)` is called by `cartStore.removeItem` so re-adding starts fresh.

## Components

- `src/components/HouseRecord.vue` — house card. Shows size/capacity, PokemonCards, a "Shared habitats" badge section (habitat with 2+ occupants is a colored `BBadge` with `data-testid="shared-habitat-badge"`), a **cart fulfillment table** (`cart-items-coverage`, only when the house has cart items), and a collapsible recommendations `<details>` panel hidden outright once every favorite is fulfilled. Recommendations come from `recommendedItemsForHouse` (tagged Relaxation/Decoration/Toy), with vertical-rotated headers (`.recommended-items-table`) and one boolean `bool-col` per tag / unfulfilled favorite. A `+` button (`add-to-cart`) adds items to that house's cart.
- `src/components/PokemonCard.vue` — horizontal card (`no-body`) with image + name + habitat pill (`habitat-badge`) + per-favorite `FavoriteBadge`s. Each favorite badge (`fave-badge`) is success+✓ when fulfilled by a cart item, danger+✗ when not.
- `src/components/FavoriteBadge.vue` — shared pill component. Props: `favorite`, `fulfilled?` (drives success/danger + ✓/✗), `informational?` (secondary variant, no prefix; overrides `fulfilled`), `count?` (renders `×N`). Emits `click(favorite)` on click or Enter/Space. Pass `informational` explicitly when no fulfillment state applies — absent `fulfilled` is coerced to `false` by Vue's boolean prop casting.
- `src/components/PokemonSelect.vue` — autocomplete multi-select. Accepts `pinnedNames: Set<string>` to disable close buttons for pinned entries.
- `src/components/ShoppingCart.vue` — `BOffcanvas` panel mounted in `App.vue` alongside main content in a flex row. `responsive="lg"` — sticky inline sidebar at ≥992px, sliding overlay below. Items grouped by house (`cart-house-group`). Each cart item has a **🔨 Crafted** stamp (`progress-checkbox-cart-item`) which strikes through the name and removes its ingredients from aggregated totals. Aggregated ingredient totals listed below all groups. Colors from `tropical-theme.css`.
- Habitat → badge-variant map is the shared `HABITAT_VARIANT` constant in `src/habitats.ts`.

**Test selectors.** Tests key off `data-testid` attributes, not Bootstrap classes. Known IDs include: `house-card`, `error`, `unhoused`, `empty`, `results`, `habitat-badge`, `shared-habitats`, `shared-habitat-badge`, `fave-badge`, `shopping-cart`, `cart-empty`, `cart-items`, `cart-item`, `cart-remove`, `cart-clear`, `cart-aggregated`, `cart-aggregated-item`, `add-to-cart`, `item-name`, `item-craftability`, `item-craftable-badge`, `item-category-badge`, `recommended-items`, `recommended-items-list`, `progress-checkbox-house`, `progress-checkbox-pokemon`, `progress-checkbox-cart-item`, `progress-checkbox-placed-item`, `progress-checkbox-placed-coverage`, `cart-house-group`, `cart-items-coverage`, `cart-coverage-table`, `cart-coverage-remove`, `cart-tag-toy`, `cart-tag-relaxation`, `cart-tag-decoration`, and dynamic `fav-header-fav_<favorite>`. Add new IDs when introducing testable UI.

## Tests

- Unit: `src/__tests__/*.spec.ts` under Vitest + jsdom, using `@vue/test-utils`.
- E2E: `e2e/*.spec.ts` under Playwright (Chromium only). `playwright.config.ts` runs `npm run dev` locally (port 5173) or `npm run preview` on CI (port 4173). Timeout 5s per test, 2s per expect.

## Deployment

GitHub Actions builds on push to `main` (installs Node from `.nvmrc`, runs `npm ci && npm run build`). Production assets are published from `dist/` to the `web` branch under `/pokopia-housing-solver/`. The Vite `base` and Vue Router `history` both key off `import.meta.env.BASE_URL` so route and asset paths stay aligned.

# Credits

Original data collection is from https://pokopia-roommate-matchmaker.netlify.app/ and https://github.com/JEschete/PokopiaPlanning.
