# UI

Vue 3 homepage styled with Bootstrap Vue Next (`bootstrap-vue-next`) that lets users configure pokemon housing scenarios and view solver results.

## HomeView

The main page at `/`, implemented in `src/views/HomeView.vue`. Uses Bootstrap Vue Next components (`BCard`, `BForm`, `BRow`/`BCol`, `BFormGroup`, `BFormInput`, `BButton`, `BAlert`, `BListGroup`, `BBadge`) with no custom CSS.

### Form

Users set house counts via `BFormInput` (type number) in a `BRow` grid and select pokemon with an autocomplete multi-select. Submitting calls [[solver#API]] and displays results below.

Pokemon data is fetched from `/pokemon_favorites.json` on mount.

### Results Display

After solving, `BCard` house cards show size, capacity, assigned pokemon, and each pokemon's favorites in a `BListGroup`. Unhoused pokemon appear in a `BAlert` warning. Error and loading states are handled inline with `BAlert` and `BSpinner`.

Houses with 2+ residents also show a "Shared interests" section: `BBadge` pills with the overlap count per favorite (e.g. "Berries ×3").

### Test Selectors

Key elements use `data-testid` attributes (`house-card`, `error`, `unhoused`, `empty`, `results`) for test selectors, decoupled from Bootstrap styling classes.

## PokemonSelect

Reusable autocomplete multi-select component at `src/components/PokemonSelect.vue`. Uses `BBadge` pills for selected items and `BListGroup` for the dropdown.

### Behavior

`BFormInput` filters names; click or Enter to select. Selected pokemon appear as dismissable `BBadge` pills with `BCloseButton` above the input.

The dropdown is keyboard-navigable with arrow keys. Accepts a full name list and a v-model array of selected names.
