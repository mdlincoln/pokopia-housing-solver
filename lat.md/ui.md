# UI

Vue 3 homepage styled with Bootstrap Vue Next (`bootstrap-vue-next`) that lets users configure pokemon housing scenarios and view solver results.

## App Shell

`src/App.vue` provides the page shell and intro copy, including the primary heading text "Pokopia Housing Solver" above the routed HomeView content.

The shell now includes a simple footer bar with a source link to the project repository: `https://github.com/mdlincoln/pokopia-housing-solver`.

The main content area and the [[ui#ShoppingCart]] sidebar are co-mounted inside a `d-flex align-items-start` wrapper: `<main class="page-main flex-fill min-w-0">` alongside `<ShoppingCart />`. This enables the sidebar to push content at lg+.

## HomeView

The main page at `/` in `src/views/HomeView.vue`, built with Bootstrap Vue Next components and a global pastel tropical theme from `src/styles/tropical-theme.css`.

### Form

Users set house counts via `BFormInput` (type number) in a `BRow` grid and select pokemon with an autocomplete multi-select. Results update automatically via Vue `watch` whenever inputs change — there is no submit button.

Asset URLs are constructed by the shared helper `src/assetPath.ts` (`assetPath(fileName)` returns `BASE_URL + fileName`). Both `HomeView` and `PokemonCard` import from this module.

A "Show a sample island" button prefills the form with 1 small, 3 medium, 2 large houses and 13 randomly chosen pokemon. It is disabled until pokemon data has loaded. It also clears the progress store (all checked houses and pokemon) before loading the new sample.

On mount, calls `loadPokemonData()` and `loadAdjacencyMap()` from [[queries]] (which internally uses `src/db.ts` / sql.js WASM) to populate `pokemonData` and `adjacencyMap`. The dev server serves the WASM file from `node_modules/sql.js/dist/sql-wasm.wasm` via a Vite middleware; production builds copy it to `dist/wasm/`. The solver runs whenever both datasets are loaded and at least one house is configured; otherwise results are hidden.

### Saved Queries

Persists query configurations (house counts + selected pokemon) to `localStorage` (`pokehousing_saved_queries`) as a JSON array of `SavedQuery` objects. New entries are prepended so the most recent appears first.

Clicking "Save query" opens a `BModal` prompting for an optional title. The modal uses `@shown` to focus the title input immediately on open. Confirming saves the entry; cancelling discards it. The `SavedQuery` object includes a `title: string` field alongside `timestamp`, `small`, `medium`, `large`, `pokemon`, and an optional `cart: Array<{ name, quantity }>` (omitted in older entries for backwards compatibility). A temporary success `BAlert` is shown for 3 seconds after a query is saved.

When saved queries exist, a `BFormSelect` dropdown appears. The timestamp is always shown. When an entry has a non-empty `title`, it is displayed first followed by the timestamp in parentheses (e.g. `My title (4/6/2026, 3:00:00 PM)`); untitled entries show only the timestamp. Selecting an entry restores all five fields into the reactive refs and calls `cartStore.restoreItems(query.cart ?? [])` to restore cart state (clearing the cart if no cart was saved), triggering the solver watcher automatically.

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

### Progress Tracking

Lets users check off houses and pokemon one by one as they complete them in-game. State is owned by `src/stores/progress.ts` (see [[ui#ShoppingCart#Progress Store]]).

Each house card has a `data-testid="progress-checkbox-house"` checkbox in the title row. Each pokemon card has a `data-testid="progress-checkbox-pokemon"` checkbox inside the card body. Checking an item applies a `.checked-off` CSS class (defined in `tropical-theme.css`) which reduces opacity and desaturates it. Items can be checked and unchecked independently and repeatedly.

Progress is saved into `SavedQuery` as `checkedHouses: number[]` and `checkedPokemon: string[]` (keys formatted as `"houseIndex:pokemonName"`). On restore, `progressStore.restoreProgress(query)` rehydrates both sets.

#### Checks off a house

Verifies that clicking a house checkbox marks that house as checked and applies the `checked-off` visual treatment, while leaving other houses unaffected.

#### Checks off a pokemon

Verifies that clicking a pokemon checkbox marks that pokemon as checked independently of its house and other pokemon in the same house.

#### Saves checkbox state with query

Verifies that when the save modal is confirmed, the stored `SavedQuery` entry includes `checkedHouses` and `checkedPokemon` arrays reflecting the current progress store state.

#### Restores checkbox state from query

Verifies that selecting a saved query that includes `checkedHouses` and `checkedPokemon` restores those arrays into the progress store so the correct items are checked after restore.

#### Sample island clears progress

Verifies that clicking "Show a sample island" after checking off a house unchecks all progress checkboxes, so the new sample starts with a clean slate.

Clicking a favorite pill from either shared house favorites or a pokemon card opens a modal showing catalog items for that exact favorite, sourced from [[items#itemsForFavorite]].

Each modal item row also shows pill badges for other favorites that same item fulfills, sourced from [[items#favoritesForItem]]. Both `selectedFavoriteItems` and `selectedFavoriteItemRows` are `ref`s populated by an async `watch` on `selectedFavorite`, since the query functions are async.

## House

Reusable house display component in `src/components/HouseRecord.vue`. Renders as a `BListGroupItem` with size/capacity, assigned `PokemonCard` entries, a "Shared habitats" badge section, and a "Shared interests" badge section.

Shared favorites are computed internally via [[src/solver.ts#rankHouseFavorites]]. Shared habitats are computed inline: if 2+ occupants share the same habitat value the habitat name and count appear as a colored `BBadge` pill (`data-testid="shared-habitat-badge"`) inside a `data-testid="shared-habitats"` wrapper.

Each `PokemonCard` receives the pokemon's `habitat` prop, which it renders as a colored `BBadge` pill (`data-testid="habitat-badge"`). The card uses a horizontal layout (`BCard` with `no-body`, `BRow`/`BCol`, `BCardImg`, `BCardBody`) with the image on the left and name + badges on the right.

Habitat-to-badge-variant mappings for both `HouseRecord` and `PokemonCard` come from the shared constant `HABITAT_VARIANT` in `src/habitats.ts`.

Shared favorite pills and pokemon-card favorite pills are interactive and emit a favorite-selection event to HomeView, which opens the item lookup modal.

House recommendations use all favorites from pokemon assigned to that house (not only shared favorites). The recommendation list shows up to three item-category clusters selected by [[items#selectTopNonOverlappingClusters]], ensuring selected clusters do not overlap favorites while maximizing total favorites covered. Favorites are passed directly to `clusterItemsByFavorites`, which handles deduplication internally.

Each recommended item has a small `+` button (`data-testid="add-to-cart"`) that calls `cartStore.addItem(itemName)` to add it to the shopping cart. The same `+` button appears on each item row in the favorite items modal in HomeView.

### Item Metadata Display

Every place an item is shown — recommended items list, favorite items modal, and shopping cart — renders metadata columns from the DB using `BTableSimple` tables (Bootstrap Vue Next) with `borderless` and `small` props for minimal visual weight.

The recommended items inside each house card use a single `BTableSimple` where each cluster's favorites label is a `<BTh :rowspan="N">` cell (data-testid `item-cluster-favorites`) spanning all N item rows of that cluster. The row where the favorites `<BTh>` appears also carries `data-testid="item-cluster"`. Rows that start a new group (after the first) receive the CSS class `row-group-start`, which applies a `border-top: 1px solid var(--bs-border-color-translucent) !important` to separate groups from one another. The modal's item list uses a flat `BTableSimple` (no rowspan, one favorite per modal).

Columns in both tables: picture thumbnail (`item-thumbnail` CSS, 32×32), item name with flavor text as native `title` tooltip (`data-testid="item-name"`), craftable badge (`data-testid="item-craftable-badge"`, "Craft" `variant="success"` / "Buy" `variant="secondary"`), and category badge (`data-testid="item-category-badge"`, `variant="warning"`). The modal additionally has an "Also fulfills" column with related favorite pill badges.

All metadata — `isCraftable`, `category`, `flavorText`, and `picturePath` — is fetched in a single SQL query inside `itemsForFavorite` (via `ItemDetails`) so no extra round trips are needed for the recommended items or modal displays.

#### Shows craftable badge on recommended items

Verifies that opening a house's recommended items list shows at least one `item-craftable-badge` with text "Craft" or "Buy".

#### Shows category badge on recommended items

Verifies that opening a house's recommended items list shows at least one `item-category-badge`.

#### Shows craftable badge in favorite modal

Verifies that clicking a shared-favorite badge and opening the modal shows `item-craftable-badge` elements on items in the list.

### Test Selectors

Test selectors use `data-testid` attributes so tests do not depend on Bootstrap CSS classes.

Current IDs include `house-card`, `error`, `unhoused`, `empty`, `results`, `habitat-badge`, `shared-habitats`, `shared-habitat-badge`, `shared-favorite-badge`, `fave-badge`, `favorite-items-modal`, `favorite-items-list`, `favorite-item-related-favorites`, `favorite-item-related-favorite-pill`, `shopping-cart`, `cart-empty`, `cart-items`, `cart-item`, `cart-quantity`, `cart-increment`, `cart-decrement`, `cart-remove`, `cart-aggregated`, `cart-aggregated-item`, `add-to-cart`, `item-name`, `item-craftable-badge`, `item-category-badge`, `progress-checkbox-house`, and `progress-checkbox-pokemon`.

## ShoppingCart

A `BOffcanvas` panel (`src/components/ShoppingCart.vue`) driven by the Pinia cart store (`src/stores/cart.ts`). Mounted in `App.vue` alongside the main content inside a flex row (`d-flex align-items-start app-content-row`).

Uses `responsive="lg"` so it renders as a sticky inline sidebar (pushing main content left) at ≥992px, and falls back to a sliding overlay at smaller viewports. Width at lg+ is 300px via `--bs-offcanvas-width`.

At lg+, Bootstrap's default `.offcanvas-lg` CSS makes the offcanvas-body a flex row and hides the offcanvas header — both are overridden in `tropical-theme.css`. The sidebar uses `display: flex; flex-direction: column` so the header is fixed at the top and the body scrolls independently (`overflow-y: auto`). The header is restored with a sky-to-mint gradient background and ocean-blue border. The panel background is a sky-to-sand gradient with a left border and soft shadow to distinguish it from the main content.

The panel lists each cart item with a small picture thumbnail, the item name (with flavor text as a native `title` tooltip), craftable/buy and category badges (see [[ui#House#Item Metadata Display]]), quantity controls (− / + / ×), and a nested ingredient list. Below a divider, aggregated totals across all items are shown as a `BListGroup`. Item and ingredient pictures are served via `assetPath()`. Items with no recipe show "(no recipe)" in muted text.

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

The Pinia store at `src/stores/cart.ts` tracks cart state globally. State includes `items` (`Map<string, { quantity, picturePath }>`), `recipes` (cached per item name), and `aggregated` (totals from [[queries#getAggregatedIngredients]]).

Actions: `addItem(name)` — increments quantity or inserts at 1, loads picture, metadata (`isCraftable`, `category`, `flavorText`), and recipe on first add via [[queries#getItemPicturePath]], [[queries#getItemMetadata]], and [[queries#getRecipeForItem]], then recomputes aggregated. `removeItem`, `incrementItem`, `decrementItem` adjust quantities (removing at 0) and recompute aggregated. `restoreItems(entries)` — clears the cart and re-hydrates from a `{ name, quantity }[]` array; fetches picturePath, metadata, and recipe for all items in parallel, then calls `recomputeAggregated` once. Used by [[ui#HomeView#Saved Queries]] restore.

Getters: `totalItems` (sum of all quantities), `itemList` (array of `CartItem` for template iteration).

### Progress Store

The Pinia store at `src/stores/progress.ts` tracks which houses and pokemon have been checked off. State: `checkedHouses` (`Set<number>`) and `checkedPokemon` (`Set<string>`, keys formatted as `"houseIndex:pokemonName"`).

Actions: `toggleHouse(houseIndex)` and `togglePokemon(houseIndex, name)` add or remove entries. `isHouseChecked(houseIndex)` / `isPokemonChecked(houseIndex, name)` return boolean. `restoreProgress({ checkedHouses?, checkedPokemon? })` replaces both sets (used by [[ui#HomeView#Saved Queries]] restore). `toSerializable()` returns arrays for JSON storage.

## PokemonSelect

Reusable autocomplete multi-select component at `src/components/PokemonSelect.vue`. Uses `BBadge` pills for selected items and `BListGroup` for the dropdown.

## Theming

Global visual theming is implemented in `src/styles/tropical-theme.css`, imported after Bootstrap styles in `src/main.ts` so overrides apply consistently.

The theme defines pastel tropical color tokens, updates Bootstrap color variables, styles cards/pills/forms/dropdowns, and adds subtle entrance/hover motion with a reduced-motion fallback. All buttons throughout the application—including action buttons and modal confirmation buttons—use consistent tropical styling with rounded borders, gradient backgrounds, and smooth hover/active animations.

A micro-polish layer adds decorative heading marks, playful badge/button treatments, and modal/dropdown accents while keeping selectors and component behavior unchanged.

PokemonSelect's dropdown is allowed to overflow the configuration card bounds so long option lists are fully visible and not clipped by the card container.

### Behavior

`BFormInput` filters names; click or Enter to select. Selected pokemon appear as dismissable `BBadge` pills with `BCloseButton` above the input.

The dropdown is keyboard-navigable with arrow keys. Accepts a full name list and a v-model array of selected names.
