# UI

Vue 3 homepage styled with Bootstrap Vue Next (`bootstrap-vue-next`) that lets users configure pokemon housing scenarios and view solver results.

## HomeView

The main page at `/`, implemented in `src/views/HomeView.vue`. Uses Bootstrap Vue Next components (`BCard`, `BButton`, `BRow`/`BCol`, `BFormGroup`, `BFormInput`, `BFormSelect`, `BAlert`, `BListGroup`) with no custom CSS.

### Form

Users set house counts via `BFormInput` (type number) in a `BRow` grid and select pokemon with an autocomplete multi-select. Results update automatically via Vue `watch` whenever inputs change — there is no submit button.

A "Show a sample island" button prefills the form with 1 small, 3 medium, 2 large houses and 13 randomly chosen pokemon. It is disabled until pokemon data has loaded.

Pokemon data is fetched from `/pokemon_favorites.json` on mount. The solver runs whenever `pokemonData` is loaded and at least one house is configured; otherwise results are hidden.

### Saved Queries

A "Save query" button persists the current house counts and selected pokemon to `localStorage` (`pokehousing_saved_queries`) as a JSON array of `SavedQuery` objects. New entries are prepended so the most recent appears first.

When saved queries exist, a `BFormSelect` dropdown appears showing each entry's timestamp via `Date.toLocaleString()`. Selecting an entry restores all four fields into the reactive refs, triggering the solver watcher automatically.

### Results Display

After solving, a full-width `BListGroup` renders one [[ui#House]] item per assigned house. Unhoused pokemon appear in a `BAlert` warning. Error and loading states are handled inline with `BAlert` and `BSpinner`.

## House

Reusable house display component in `src/components/HouseRecord.vue`. Renders as a `BListGroupItem` with size/capacity, assigned `PokemonCard` entries, a "Shared habitats" badge section, and a "Shared interests" badge section.

Shared favorites are computed internally via [[src/solver.ts#rankHouseFavorites]]. Shared habitats are computed inline: if 2+ occupants share the same habitat value the habitat name and count appear as a colored `BBadge` pill (`data-testid="shared-habitat-badge"`) inside a `data-testid="shared-habitats"` wrapper.

Each `PokemonCard` receives the pokemon's `habitat` prop, which it renders as a colored `BBadge` pill (`data-testid="habitat-badge"`) in the card footer.

### Test Selectors

Key elements use `data-testid` attributes for test selectors, decoupled from Bootstrap styling classes: `house-card`, `error`, `unhoused`, `empty`, `results`, `habitat-badge`, `shared-habitats`, `shared-habitat-badge`.

## PokemonSelect

Reusable autocomplete multi-select component at `src/components/PokemonSelect.vue`. Uses `BBadge` pills for selected items and `BListGroup` for the dropdown.

### Behavior

`BFormInput` filters names; click or Enter to select. Selected pokemon appear as dismissable `BBadge` pills with `BCloseButton` above the input.

The dropdown is keyboard-navigable with arrow keys. Accepts a full name list and a v-model array of selected names.
