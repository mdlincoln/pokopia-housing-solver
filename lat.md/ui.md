# UI

Vue 3 homepage styled with Bootstrap Vue Next (`bootstrap-vue-next`) that lets users configure pokemon housing scenarios and view solver results.

## HomeView

The main page at `/`, implemented in `src/views/HomeView.vue`. Uses Bootstrap Vue Next components (`BCard`, `BRow`/`BCol`, `BFormGroup`, `BFormInput`, `BAlert`, `BListGroup`) with no custom CSS.

### Form

Users set house counts via `BFormInput` (type number) in a `BRow` grid and select pokemon with an autocomplete multi-select. Results update automatically via Vue `watch` whenever inputs change — there is no submit button.

Pokemon data is fetched from `/pokemon_favorites.json` on mount. The solver runs whenever `pokemonData` is loaded and at least one house is configured; otherwise results are hidden.

### Results Display

After solving, a full-width `BListGroup` renders one [[ui#House]] item per assigned house. Unhoused pokemon appear in a `BAlert` warning. Error and loading states are handled inline with `BAlert` and `BSpinner`.

## House

Reusable house display component in `src/components/HouseRecord.vue`. Renders as a `BListGroupItem` with size/capacity, assigned `PokemonCard` entries, and a "Shared interests" `BBadge` section for favorites shared by 2+ residents.

Shared favorites are computed internally via [[src/solver.ts#rankHouseFavorites]].

### Test Selectors

Key elements use `data-testid` attributes (`house-card`, `error`, `unhoused`, `empty`, `results`) for test selectors, decoupled from Bootstrap styling classes.

## PokemonSelect

Reusable autocomplete multi-select component at `src/components/PokemonSelect.vue`. Uses `BBadge` pills for selected items and `BListGroup` for the dropdown.

### Behavior

`BFormInput` filters names; click or Enter to select. Selected pokemon appear as dismissable `BBadge` pills with `BCloseButton` above the input.

The dropdown is keyboard-navigable with arrow keys. Accepts a full name list and a v-model array of selected names.
