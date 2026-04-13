# UI

Vue 3 homepage styled with Bootstrap Vue Next (`bootstrap-vue-next`) that lets users configure pokemon housing scenarios and view solver results.

## App Shell

`src/App.vue` provides the page shell and intro copy, including the primary heading text "Pokopia Housing Solver" above the routed HomeView content.

The shell now includes a simple footer bar with a source link to the project repository: `https://github.com/mdlincoln/pokopia-housing-solver`.

The main content area and the [[ui#ShoppingCart]] sidebar are co-mounted inside a `d-flex align-items-start` wrapper: `<main class="page-main flex-fill min-w-0">` alongside `<ShoppingCart />`. This enables the sidebar to push content at lg+.

## HomeView

The main page at `/` in `src/views/HomeView.vue`, built with Bootstrap Vue Next components and a global pastel tropical theme from `src/styles/tropical-theme.css`.

### Form

Users set house counts via `BFormSpinbutton` (`role="spinbutton"`) in a `BRow` grid and select pokemon with an autocomplete multi-select. Results update automatically via Vue `watch` whenever inputs change — there is no submit button.

Asset URLs are constructed by the shared helper `src/assetPath.ts` (`assetPath(fileName)` returns `BASE_URL + fileName`). Both `HomeView` and `PokemonCard` import from this module.

A "Clear all" button resets the form to a blank state: all house counts to 0, selected pokemon to none, and clears pins, progress, and the house registry. A "Show a sample island" button prefills the form with 1 small, 3 medium, 2 large houses and 13 randomly chosen pokemon. It is disabled until pokemon data has loaded. It also clears pins, progress, and the house registry before loading the new sample.

On mount, calls `loadPokemonData()` and `loadAdjacencyMap()` from [[queries]] (which internally uses `src/db.ts` / sql.js WASM) to populate `pokemonData` and `adjacencyMap`. The dev server serves the WASM file from `node_modules/sql.js/dist/sql-wasm.wasm` via a Vite middleware; production builds copy it to `dist/wasm/`. The solver runs whenever both datasets are loaded and at least one house is configured; otherwise results are hidden.

### Saved Queries

Persists query configurations (house counts + selected pokemon) to `localStorage` (`pokehousing_saved_queries`) as a JSON array of `SavedQuery` objects. New entries are prepended so the most recent appears first.

Clicking "Save query" opens a `BModal` prompting for an optional title. The modal uses `@shown` to focus the title input immediately on open. Confirming saves the entry; cancelling discards it. The `SavedQuery` object includes a `title: string` field alongside `timestamp`, `small`, `medium`, `large`, `pokemon`, an optional `cart: Array<{ houseId?, name, quantity }>` (each entry associates items with the house they belong to), optional `checkedCartItems: string[]`, and (for version 2+) `pinnedHouses`, `pinnedPokemon`, `houseRegistry`, and `houseCounters`. A temporary success `BAlert` is shown for 3 seconds after a query is saved.

When saved queries exist, a `BFormSelect` dropdown appears. The timestamp is always shown. When an entry has a non-empty `title`, it is displayed first followed by the timestamp in parentheses (e.g. `My title (4/6/2026, 3:00:00 PM)`); untitled entries show only the timestamp. Selecting an entry restores all fields into the reactive refs, calls `cartStore.restoreItems(query.cart ?? [])` to restore per-house cart state, calls `progressStore.restoreProgress(query)` to restore cart-item progress checkboxes, and restores pin state and house registry if present (version 2+), triggering the solver watcher automatically.

#### URL Sharing

Scenario state is reactively encoded into the URL hash as base64 JSON so users can share links.

A `watch` on all state sources (house counts, selected pokemon, cart items, progress checkboxes, and pin state) updates the hash via `history.replaceState` whenever any value changes. Version 2 hashes include `pinnedHouses`, `pinnedPokemon`, `houseRegistry`, and `houseCounters`. When a new user visits a URL with a hash fragment, `onMounted` decodes the state, saves it as an unlabeled `SavedQuery` in localStorage, restores all fields (including house registry and pins if present), and clears the hash. A `restoringFromUrl` flag suppresses the hash watcher during import.

##### Hash updates reactively

Verifies that after configuring houses and pokemon, the URL gains a non-empty hash fragment whose decoded payload matches the configured state.

##### Restores houses and pokemon from hash

Verifies that navigating to a URL with an encoded hash automatically restores house counts and selected pokemon so the solver displays the correct results.

##### Saves imported state as unlabeled scenario

Verifies that importing from a URL hash creates an unlabeled (timestamp-only) entry in the saved queries dropdown in localStorage.

##### Restores cart items from hash

Verifies that cart entries encoded in the hash are restored into the shopping cart with the correct quantities.

##### Restores pins from hash

Verifies that `pinnedHouses` and `pinnedPokemon` encoded in a version 2 hash are restored so the correct pin checkboxes appear checked.

#### Loads legacy entry without checkbox fields

Verifies that a saved entry from before checkbox tracking was added (missing `checkedHouses`, `checkedPokemon`, `checkedCartItems`) restores successfully with all progress checkboxes unchecked.

#### Loads legacy cart entry without houseIndex

Verifies that a saved cart entry from before per-house cart tracking (missing `houseIndex` on cart items) restores the items into the cart with the correct quantity.

#### Loads legacy entry with no cart field

Verifies that a saved entry with no `cart` field at all restores the housing configuration and leaves the cart empty without errors.

#### Focuses input on modal open

Verifies that when the save modal is opened, the title input receives keyboard focus immediately so the user can start typing without clicking.

#### Shows success alert after save

Verifies that after confirming the save modal, a success alert appears and then disappears automatically after 3 seconds.

#### Saves title with query

Verifies that when the user provides a title in the save modal and confirms, the stored `SavedQuery` entry has the `title` field set to the provided value.

#### Saves cart items with saved query

Verifies that when the cart contains items, confirming the save modal writes a `cart` array of `{ name, quantity }` objects into the stored `SavedQuery` entry in localStorage.

#### Restores cart from saved query

Verifies that selecting a saved query that includes a `cart` field calls `cartStore.restoreItems` with the saved cart entries, so the shopping cart state is fully restored alongside the housing configuration.

#### Shows title in restore dropdown

Verifies that when a saved query has a non-empty title, the restore dropdown option displays both the title and the timestamp string.

### Results Display

After solving, a full-width `BListGroup` renders one [[ui#House]] item per assigned house. Unhoused pokemon appear in a `BAlert` warning. Error and loading states are handled inline with `BAlert` and `BSpinner`.

### Pinning

Lets users lock pokemon into specific houses and lock entire houses so they persist across re-solves. State is owned by `src/stores/pins.ts` (see [[ui#ShoppingCart#Pin Store]]).

Each house card has a `data-testid="progress-checkbox-house"` checkbox in the title row. Each pokemon card has a `data-testid="progress-checkbox-pokemon"` checkbox inside the card body. Pinning a house pins all its current occupants AND prevents the house from being removed when reducing house counts. Pinning applies a `.checked-off` CSS class (defined in `tropical-theme.css`) which reduces opacity and desaturates it. Pinned pokemon cannot be removed from PokemonSelect (their close button is disabled).

House count inputs have computed `:min` values based on how many houses of each size are effectively pinned (either explicitly or by having pinned pokemon). Reducing a count below the pinned minimum is clamped.

Pin state is saved into `SavedQuery` as `pinnedHouses: string[]` and `pinnedPokemon: string[]` (keys formatted as `"houseId:pokemonName"`). On restore, `pinStore.restorePins(query)` rehydrates both sets.

#### Saves pin state with query

Verifies that when the save modal is confirmed, the stored `SavedQuery` entry includes `pinnedHouses` and `pinnedPokemon` arrays reflecting the current pin store state.

#### Restores pin state from query

Verifies that selecting a saved query with `pinnedHouses` and `pinnedPokemon` restores those arrays into the pin store so the correct items are pinned after restore.

#### Sample island clears progress

Verifies that clicking "Show a sample island" after pinning a house clears all pins and progress checkboxes, so the new sample starts with a clean slate.

Clicking a favorite pill from either shared house favorites or a pokemon card opens a modal showing catalog items for that exact favorite, sourced from [[items#itemsForFavorite]].

Each modal item row also shows pill badges for other favorites that same item fulfills, sourced from [[items#favoritesForItem]]. Both `selectedFavoriteItems` and `selectedFavoriteItemRows` are `ref`s populated by an async `watch` on `selectedFavorite`, since the query functions are async.

## House

Reusable house display component in `src/components/HouseRecord.vue`. Renders as a `BListGroupItem` with size/capacity, assigned `PokemonCard` entries, a "Shared habitats" badge section, and a "Shared interests" badge section.

Shared favorites are computed internally via [[src/solver.ts#rankHouseFavorites]]. Shared habitats are computed inline: if 2+ occupants share the same habitat value the habitat name and count appear as a colored `BBadge` pill (`data-testid="shared-habitat-badge"`) inside a `data-testid="shared-habitats"` wrapper.

Each `PokemonCard` receives the pokemon's `habitat` prop, which it renders as a colored `BBadge` pill (`data-testid="habitat-badge"`). The card uses a horizontal layout (`BCard` with `no-body`, `BRow`/`BCol`, `BCardImg`, `BCardBody`) with the image on the left and name + badges on the right.

Habitat-to-badge-variant mappings for both `HouseRecord` and `PokemonCard` come from the shared constant `HABITAT_VARIANT` in `src/habitats.ts`.

Shared favorite pills, cluster-favorites pills, and pokemon-card favorite pills are all rendered via the shared `FavoriteBadge` component (`src/components/FavoriteBadge.vue`). They are interactive and emit a favorite-selection event to HomeView, which opens the item lookup modal.

### FavoriteBadge

A reusable pill badge component used wherever a fulfilled/unfulfilled interactive favorite badge is needed.

Props: `favorite: string` (display name), `fulfilled?: boolean` (drives variant and icon), `informational?: boolean` (renders `variant="secondary"` with no prefix — overrides `fulfilled`; used for reference-only badges), `count?: number` (renders `×N` suffix for shared-favorites). The `data-testid` attribute is forwarded to the root element via Vue attribute inheritance. Emits `click(favorite: string)` on click or Enter/Space keydown.

When `fulfilled` is `true` renders `variant="success"` with a `✓` prefix; when `false` renders `variant="danger"` with a `✗` prefix; when `informational` is set renders `variant="secondary"` with no prefix. Note: Vue's boolean prop casting converts absent `fulfilled` to `false`, so pass `informational` explicitly when no fulfillment state applies.

Used at four sites: `PokemonCard` per-pokemon favorites (`data-testid="fave-badge"`), `HouseRecord` shared favorites (`data-testid="shared-favorite-badge"`, passes `count`), `HouseRecord` cluster favorites (`data-testid="cluster-favorite-badge"`), and `HomeView` "Also fulfills" column in the items modal (`data-testid="favorite-item-related-favorite-pill"`, uses `informational`). Clicking an "Also fulfills" badge calls `openFavoriteItemsModal` to navigate the modal to that favorite.

House recommendations use all favorites from pokemon assigned to that house (not only shared favorites). The recommendation list shows all item clusters returned by [[items#clusterTaggedItemsForHouse]], filtered to items tagged Relaxation, Decoration, or Toy and ranked by score (sum of pokemon-favorite matches).

Each recommended item has a small `+` button (`data-testid="add-to-cart"`) that calls `cartStore.addItem(houseId, itemName)` to add it to the shopping cart for that house. A checkmark cell (`data-testid="item-in-cart-check"`) in each row displays `✓` in success color when that item is already in the house's cart, and is empty otherwise; it updates reactively as items are added or removed. The same `+` button appears on each item row in the favorite items modal in HomeView, passing the originating house ID.

`HouseRecord` passes a `fulfilledFavorites` prop (a `Set<string>` of lowercased favorite names) to each `PokemonCard`. This set is computed by watching `houseCartItems` and calling `favoritesForItem` for each cart item. `PokemonCard` renders each favorite badge with `variant="success"` and a `✓` prefix when fulfilled, and `variant="danger"` with a `✗` prefix when unfulfilled. The shared favorite badges at the top of the house card use the same fulfilled/unfulfilled treatment (checking against `fulfilledFavorites`), replacing the previous static `variant="info"`.

A tag fulfillment row (`data-testid="tag-fulfillment-status"`) is rendered below the pokemon cards, above the recommended items. It always shows three `BBadge` pills for "Relaxation", "Toy", and "Decoration". Each uses `variant="success"` with a `✓` prefix once at least one cart item with that tag has been added to the house, and `variant="danger"` with a `✗` prefix otherwise. The fulfilled tags set is computed inline from `houseCartItems` using the `tag` field already present on `CartItem`.

Below the recommended items, a "Shopping list" section (`data-testid="house-cart-items"`) appears when the house has cart items. Each item shows a progress checkbox (`data-testid="progress-checkbox-cart-item"`), thumbnail, quantity, and name. Checking an item applies `checked-off` opacity/grayscale and `text-decoration-line-through` on the name. The same checkbox state is shared with the sidebar via the progress store.

### Item Metadata Display

Every place an item is shown — recommended items list, favorite items modal, and shopping cart — renders metadata columns from the DB using Bootstrap Vue Next table components with `borderless` and `small` props for minimal visual weight.

The recommended items inside each house card use a `BTable` with one row per item (no rowspan grouping). Columns are: item name with flavor text tooltip (`data-testid="item-name"`), picture thumbnail (`item-thumbnail` CSS, 32×32), add-to-cart button (`data-testid="add-to-cart"`) and in-cart checkmark (`data-testid="item-in-cart-check"`), craftability text (`data-testid="item-craftability"` — "Craftable - {category}" for craftable items, "Buy" otherwise), tag badge (`data-testid="item-tag-badge"`, `variant="info"`, only shown when non-null), and one column per distinct favorite of pokemon assigned to the house. Favorite columns are ordered by frequency (most-shared first, ties sorted alphabetically); each cell shows `✓` when the item covers that favorite, empty otherwise. The table is sorted by BTable's built-in sort; the default sort is the first favorite column descending so items covering the most-common favorite appear at the top. The modal's item list uses a flat `BTableSimple` (no per-favorite columns, one favorite per modal).

All metadata — `isCraftable`, `category`, `flavorText`, and `picturePath` — is fetched in a single SQL query inside `itemsForFavorite` (via `ItemDetails`) so no extra round trips are needed for the recommended items or modal displays.

#### Shows craftability text on recommended items

Verifies that the recommended items list shows at least one `item-craftability` cell with text starting "Craftable" (for a craftable item) and at least one with text "Buy" (for a non-craftable item).

#### Shows craftability includes category for craftable items

Verifies that the `item-craftability` cell for a craftable item includes the item's category (e.g., "Craftable - Outdoor"), confirming category is surfaced without a separate badge.

#### Shows craftable badge in favorite modal

Verifies that clicking a shared-favorite badge and opening the modal shows `item-craftable-badge` elements on items in the list.

#### Tag fulfillment row always present

The tag row (`tag-fulfillment-status`) and all three tag status badges (`tag-status-relaxation`, `tag-status-toy`, `tag-status-decoration`) are always rendered regardless of cart state.

#### Tag badges start secondary

Before any cart items are added, all three tag status badges carry `variant="secondary"`.

#### Tag badge turns success after item added

After calling `cartStore.addItem` for an item with a given tag, the corresponding tag status badge switches to `variant="success"`.

#### Fulfilled favorite badge turns success

Before adding cart items a pokemon's favorite badge has no success variant. After adding a cart item whose favorites include that pokemon's favorite, the badge turns `variant="success"`.

#### Fulfilled favorites do not bleed across houses

Adding a cart item to one house's slot does not cause another house's favorite badges to turn success.

### Test Selectors

Test selectors use `data-testid` attributes so tests do not depend on Bootstrap CSS classes.

Current IDs include `house-card`, `error`, `unhoused`, `empty`, `results`, `habitat-badge`, `shared-habitats`, `shared-habitat-badge`, `shared-favorite-badge`, `fave-badge`, `favorite-items-modal`, `favorite-items-list`, `favorite-item-related-favorites`, `favorite-item-related-favorite-pill`, `shopping-cart`, `cart-empty`, `cart-items`, `cart-item`, `cart-quantity`, `cart-increment`, `cart-decrement`, `cart-remove`, `cart-aggregated`, `cart-aggregated-item`, `add-to-cart`, `item-in-cart-check`, `item-name`, `item-craftability`, `item-craftable-badge`, `item-category-badge`, `item-tag-badge`, `progress-checkbox-house`, `progress-checkbox-pokemon`, `progress-checkbox-cart-item`, `cart-house-group`, `house-cart-items`, `house-cart-item`, `tag-fulfillment-status`, `tag-status-relaxation`, `tag-status-toy`, and `tag-status-decoration`.

## ShoppingCart

A `BOffcanvas` panel (`src/components/ShoppingCart.vue`) driven by the Pinia cart store (`src/stores/cart.ts`). Mounted in `App.vue` alongside the main content inside a flex row (`d-flex align-items-start app-content-row`).

Uses `responsive="lg"` so it renders as a sticky inline sidebar (pushing main content left) at ≥992px, and falls back to a sliding overlay at smaller viewports. Width at lg+ is 300px via `--bs-offcanvas-width`.

At lg+, Bootstrap's default `.offcanvas-lg` CSS makes the offcanvas-body a flex row and hides the offcanvas header — both are overridden in `tropical-theme.css`. The sidebar uses `display: flex; flex-direction: column` so the header is fixed at the top and the body scrolls independently (`overflow-y: auto`). The header is restored with a sky-to-mint gradient background and ocean-blue border. The panel background is a sky-to-sand gradient with a left border and soft shadow to distinguish it from the main content.

Items are grouped by house (`data-testid="cart-house-group"`), with a heading showing the house ID. Each cart item has a progress checkbox (`data-testid="progress-checkbox-cart-item"`) that toggles the `.checked-off` visual treatment and `text-decoration-line-through` on the item name via the progress store. The same checkbox state is shared with the house card's shopping list section. Items also show a small picture thumbnail, the item name (with flavor text as a native `title` tooltip), craftable/buy and category badges (see [[ui#House#Item Metadata Display]]), quantity controls (− / + / ×), and a nested ingredient list. Below all house groups, aggregated totals across all items are shown as a `BListGroup`. Item and ingredient pictures are served via `assetPath()`. Items with no recipe show "(no recipe)" in muted text.

The sidebar has no toggle button or close button — it is permanently visible. Height is `100vh` so it fills the full viewport even when the cart is empty.

### Opens and closes the panel

At lg+ the sidebar renders inline and is always visible without requiring a toggle; the empty-state message shows when the cart has no items and the items list is hidden until items are added. The Cart button remains available for mobile use.

### Adds item from recommended items

After expanding a house's recommended items details and clicking a `+` button, opening the cart shows that item with quantity 1 and the Cart button badge shows 1.

### Adds item from favorite items modal

After clicking a shared-favorite badge, opening the favorite items modal, and clicking `+` on an item, the cart contains that item when the panel is opened.

### Incrementing quantity updates badge

After adding an item and clicking the `+` (increment) button inside the cart panel, the quantity display changes to 2.

### Remove clears item from cart

Clicking the `×` (remove) button on a cart entry removes the entire entry regardless of quantity; if it was the last item, the empty-state message returns.

### Clear all empties the cart

A "Clear all" button (`data-testid="cart-clear"`) appears above the items list when the cart has at least one item. Clicking it removes all items at once and restores the empty-state message.

### Cart Store

The Pinia store at `src/stores/cart.ts` tracks cart state per house using composite `"houseId:itemName"` keys.

State: `items` (`Map<string, CartEntry>` with `houseId`, `quantity`, `picturePath`, `isCraftable`, `category`, `flavorText`), `recipes` (cached per item name), `aggregated` (totals from [[queries#getAggregatedIngredients]]).

Actions: `addItem(houseId, name)` — increments quantity or inserts at 1 for the given house, loads picture, metadata, and recipe on first add via [[queries#getItemPicturePath]], [[queries#getItemMetadata]], and [[queries#getRecipeForItem]], then recomputes aggregated. `removeItem(houseId, name)`, `incrementItem(houseId, name)`, `decrementItem(houseId, name)` adjust quantities (removing at 0) and recompute aggregated. `restoreItems(entries)` — clears the cart and re-hydrates from a `{ houseId?, houseIndex?, name, quantity }[]` array (legacy entries with `houseIndex` are accepted for backward compat); fetches metadata and recipes for all items in parallel, then calls `recomputeAggregated` once. Used by [[ui#HomeView#Saved Queries]] restore.

Getters: `totalItems` (sum of all quantities), `itemList` (array of `CartItem` including `houseId` for template iteration), `itemsByHouse` (`Map<string, CartItem[]>` grouping `itemList` by house — used by `ShoppingCart.vue` for grouped rendering).

### Progress Store

The Pinia store at `src/stores/progress.ts` tracks which cart items have been checked off. House and pokemon checkbox tracking has been moved to the pin store (see [[ui#ShoppingCart#Pin Store]]).

State: `checkedCartItems` (`Set<string>`, keys `"houseId:itemName"`).

Actions: `toggleCartItem(houseId, name)` adds or removes entries. `isCartItemChecked(houseId, name)` returns boolean. `restoreProgress({ checkedCartItems? })` replaces the set (used by [[ui#HomeView#Saved Queries]] restore). `toSerializable()` returns arrays for JSON storage.

### Pin Store

The Pinia store at `src/stores/pins.ts` tracks which houses and pokemon are pinned/locked.

State: `pinnedHouses` (`Set<string>`, house IDs), `pinnedPokemon` (`Set<string>`, keys `"houseId:pokemonName"`).

Actions: `pinHouse(houseId, currentOccupants)` pins the house AND all its current occupants. `unpinHouse(houseId)` unpins the house (leaves individual pokemon pins intact). `toggleHousePin(houseId, currentOccupants)` / `togglePokemonPin(houseId, name)` toggle pin state. `getPinnedAssignments()` returns `Map<string, string[]>` for the solver's pinned pre-placement. `restorePins({ pinnedHouses?, pinnedPokemon? })` replaces both sets. `clear()` removes all pins.

Computed: `effectivelyPinnedHouseIds` — houses explicitly pinned OR having any pinned pokemon. `allPinnedPokemonNames` — flat set of pinned pokemon names (used by PokemonSelect to disable close buttons).

## House Registry Store

The Pinia store at `src/stores/houses.ts` manages stable house identity with unique string IDs.

Each house gets an ID like `S1`, `M2`, `L1` — a size prefix (`S`/`M`/`L`) plus a monotonic per-size counter. IDs are stable across re-solves: adding or removing houses increments the counter but never reuses old IDs. Pinned houses cannot be removed when reducing counts.

Actions: `reconcileHouses(config, pinnedHouseIds)` adds/removes houses to match desired counts while never removing pinned houses (removes unlocked houses with highest counter first). `restoreRegistry(data)` / `toSerializable()` for persistence. `clear()` resets all state.

Computed: `orderedHouses` — all houses sorted large → medium → small, then by counter. `lockedCountBySize(pinnedIds)` — returns per-size counts of pinned houses for computing minimum input values.

## PokemonSelect

Reusable autocomplete multi-select component at `src/components/PokemonSelect.vue`. Uses `BBadge` pills for selected items and `BListGroup` for the dropdown.

Accepts an optional `pinnedNames: Set<string>` prop; when a pokemon name is in the set, its `BCloseButton` is disabled so it cannot be removed until unpinned.

## Theming

Global visual theming is implemented in `src/styles/tropical-theme.css`, imported after Bootstrap styles in `src/main.ts` so overrides apply consistently.

The theme defines pastel tropical color tokens, updates Bootstrap color variables, styles cards/pills/forms/dropdowns, and adds subtle entrance/hover motion with a reduced-motion fallback. All buttons throughout the application—including action buttons and modal confirmation buttons—use consistent tropical styling with rounded borders, gradient backgrounds, and smooth hover/active animations.

A micro-polish layer adds decorative heading marks, playful badge/button treatments, and modal/dropdown accents while keeping selectors and component behavior unchanged.

PokemonSelect's dropdown is allowed to overflow the configuration card bounds so long option lists are fully visible and not clipped by the card container.

### Behavior

`BFormInput` filters names; click or Enter to select. Selected pokemon appear as dismissable `BBadge` pills with `BCloseButton` above the input.

The dropdown is keyboard-navigable with arrow keys. Accepts a full name list and a v-model array of selected names.
