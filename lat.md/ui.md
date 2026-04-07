# UI

Vue 3 homepage styled with Bootstrap Vue Next (`bootstrap-vue-next`) that lets users configure pokemon housing scenarios and view solver results.

## HomeView

The main page at `/`, implemented in `src/views/HomeView.vue`. Uses Bootstrap Vue Next components (`BCard`, `BButton`, `BRow`/`BCol`, `BFormGroup`, `BFormInput`, `BFormSelect`, `BAlert`, `BListGroup`) with no custom CSS.

### Form

Users set house counts via `BFormInput` (type number) in a `BRow` grid and select pokemon with an autocomplete multi-select. Results update automatically via Vue `watch` whenever inputs change — there is no submit button.

A "Show a sample island" button prefills the form with 1 small, 3 medium, 2 large houses and 13 randomly chosen pokemon. It is disabled until pokemon data has loaded.

Pokemon data is fetched from `/pokemon_favorites.json` and adjacency data is fetched from `/pokemon_adjacency.json` on mount. The solver runs whenever both datasets are loaded and at least one house is configured; otherwise results are hidden.

### Saved Queries

Persists query configurations (house counts + selected pokemon) to `localStorage` (`pokehousing_saved_queries`) as a JSON array of `SavedQuery` objects. New entries are prepended so the most recent appears first.

Clicking "Save query" opens a `BModal` prompting for an optional title. The modal uses `@shown` to focus the title input immediately on open. Confirming saves the entry; cancelling discards it. The `SavedQuery` object includes a `title: string` field alongside `timestamp`, `small`, `medium`, `large`, and `pokemon`. A temporary success `BAlert` is shown for 3 seconds after a query is saved.

When saved queries exist, a `BFormSelect` dropdown appears. The timestamp is always shown. When an entry has a non-empty `title`, it is displayed first followed by the timestamp in parentheses (e.g. `My title (4/6/2026, 3:00:00 PM)`); untitled entries show only the timestamp. Selecting an entry restores all four fields into the reactive refs, triggering the solver watcher automatically.

#### Focuses input on modal open

Verifies that when the save modal is opened, the title input receives keyboard focus immediately so the user can start typing without clicking.

#### Shows success alert after save

Verifies that after confirming the save modal, a success alert appears and then disappears automatically after 3 seconds.

#### Saves title with query

Verifies that when the user provides a title in the save modal and confirms, the stored `SavedQuery` entry has the `title` field set to the provided value.

#### Shows title in restore dropdown

Verifies that when a saved query has a non-empty title, the restore dropdown option displays both the title and the timestamp string.

### Results Display

After solving, a full-width `BListGroup` renders one [[ui#House]] item per assigned house. Unhoused pokemon appear in a `BAlert` warning. Error and loading states are handled inline with `BAlert` and `BSpinner`.

Clicking a favorite pill from either shared house favorites or a pokemon card opens a modal showing catalog items for that exact favorite, sourced from [[items#itemsForFavorite]].

## House

Reusable house display component in `src/components/HouseRecord.vue`. Renders as a `BListGroupItem` with size/capacity, assigned `PokemonCard` entries, a "Shared habitats" badge section, and a "Shared interests" badge section.

Shared favorites are computed internally via [[src/solver.ts#rankHouseFavorites]]. Shared habitats are computed inline: if 2+ occupants share the same habitat value the habitat name and count appear as a colored `BBadge` pill (`data-testid="shared-habitat-badge"`) inside a `data-testid="shared-habitats"` wrapper.

Each `PokemonCard` receives the pokemon's `habitat` prop, which it renders as a colored `BBadge` pill (`data-testid="habitat-badge"`). The card uses a horizontal layout (`BCard` with `no-body`, `BRow`/`BCol`, `BCardImg`, `BCardBody`) with the image on the left and name + badges on the right.

Shared favorite pills and pokemon-card favorite pills are interactive and emit a favorite-selection event to HomeView, which opens the item lookup modal.

House recommendations use all favorites from pokemon assigned to that house (not only shared favorites). The recommendation list shows up to three item-category clusters selected by [[items#selectTopNonOverlappingClusters]], ensuring selected clusters do not overlap favorites while maximizing total favorites covered.

### Test Selectors

Test selectors use `data-testid` attributes so tests do not depend on Bootstrap CSS classes.

Current IDs include `house-card`, `error`, `unhoused`, `empty`, `results`, `habitat-badge`, `shared-habitats`, `shared-habitat-badge`, `shared-favorite-badge`, `fave-badge`, `favorite-items-modal`, and `favorite-items-list`.

## PokemonSelect

Reusable autocomplete multi-select component at `src/components/PokemonSelect.vue`. Uses `BBadge` pills for selected items and `BListGroup` for the dropdown.

### Behavior

`BFormInput` filters names; click or Enter to select. Selected pokemon appear as dismissable `BBadge` pills with `BCloseButton` above the input.

The dropdown is keyboard-navigable with arrow keys. Accepts a full name list and a v-model array of selected names.
