# Solver

Z3-based optimization module that assigns pokemon to houses, maximizing shared favorites between housemates.

## API

The solver exposes a single async `solve` function and supporting types via [[src/solver.ts#solve]].

### Inputs

The function accepts three arguments describing the optimization problem.

- `pokemonNames: string[]` — names matching keys in `public/pokemon_favorites.json`
- `housingConfig: HousingConfig` — `{ small: number, medium: number, large: number }` specifying house counts
- `pokemonData: PokemonData` — the favorites dataset keyed by pokemon name

### Outputs

Returns a `SolverResult` with house assignments and any unhoused pokemon.

- `houses: HouseAssignment[]` — each house with its index, size, capacity, and assigned pokemon
- `unhoused: string[]` — pokemon that could not be placed

## House Sizes

Houses have fixed capacities: small (1 slot), medium (2 slots), large (4 slots).

## Z3 Encoding

The solver uses Z3's `Optimize` class for multi-objective optimization.

### Variables

One integer variable per pokemon: 0 means unhoused, 1..N maps to a specific house.

### Constraints

Domain bounds and per-house capacity limits enforce valid assignments.

### Objectives

Two objectives in lexicographic order: first minimize unhoused count, then maximize total shared favorites between housemates. Pairs with zero shared favorites are pruned from the objective.

## Helpers

Exported utility functions used internally and in tests.

### enumerateHouses

Flattens a `HousingConfig` into an ordered list of houses with indices and capacities. See [[src/solver.ts#enumerateHouses]].

### countSharedFavorites

Returns the number of overlapping favorites between two pokemon. See [[src/solver.ts#countSharedFavorites]].
