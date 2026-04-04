# UI

Vue 3 homepage that lets users configure pokemon housing scenarios and view solver results.

## HomeView

The main page at `/`, implemented in `src/views/HomeView.vue`.

### Form

Users set house counts via integer inputs and select pokemon with an autocomplete multi-select. Pokemon data is fetched from `/pokemon_favorites.json` on mount. Submitting the form calls [[solver#API]] and displays results below.

### Results Display

After solving, house assignments render as cards showing size, capacity, and assigned pokemon. Unhoused pokemon appear in a separate highlighted section. Error and loading states are handled inline.

## PokemonSelect

Reusable autocomplete multi-select component at `src/components/PokemonSelect.vue`.

### Behavior

Text input filters names; click or Enter to select. Selected pokemon appear as removable chips above the input.

The dropdown is keyboard-navigable with arrow keys. Accepts a full name list and a v-model array of selected names.
