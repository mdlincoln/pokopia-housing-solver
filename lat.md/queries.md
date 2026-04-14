# Queries

All SQLite read queries for `public/pokehousing.sqlite`. This is the single module that calls `getDb()` and `db.exec()`. Vue components and other modules must not contain SQL — they import from here instead. Lives in [[src/queries.ts]].

## loadPokemonNames

Loads the full sorted list of pokemon names for selection UI without hydrating the rest of each record. See [[src/queries.ts#loadPokemonNames]].

Returns `string[]` ordered alphabetically by pokemon name. HomeView calls this once on mount so the autocomplete can work before favorites, habitat, and image data are loaded.

## loadPokemonData

Loads pokemon image paths, habitats, and favorites for either the full catalog or a requested subset of names. See [[src/queries.ts#loadPokemonData]].

Returns a `PokemonData` record keyed by pokemon name, with each entry holding `image`, `favorites`, and `habitat`. Uses a `GROUP_CONCAT` of `pokemon_favorites` joined to `pokemon`. HomeView now uses the optional names filter to hydrate only the currently selected pokemon after startup.

## loadAdjacencyMap

Loads the precomputed pairwise compatibility scores from the `adjacency` table. See [[src/queries.ts#loadAdjacencyMap]].

Returns an `AdjacencyMap` (`Map<string, Map<string, number | null>>`). Entries are stored symmetrically (both directions). Called once on mount by HomeView and passed to the solver.

## itemsForFavorite

Looks up catalog item details for a single favorite. See [[src/queries.ts#itemsForFavorite]].

Case-insensitive lookup via normalized favorite name. Returns `ItemDetails[]` in database order. Each entry includes `name`, `isCraftable` (true if the item has at least one recipe row), `category`, `flavorText`, and `picturePath`.

## getItemMetadata

Returns craftable status, category, flavor text, and tag for a single item by name. See [[src/queries.ts#getItemMetadata]].

Case-insensitive lookup. Returns `{ isCraftable, category, flavorText, tag }`. Used by the cart store when a new item is first added so the cart can display badges and tooltips. Returns all-null/false defaults if the item is not found.

## favoritesForItem

Returns all favorites fulfilled by a single item. See [[src/queries.ts#favoritesForItem]].

Case-insensitive item name lookup; results are alphabetically sorted as returned by the DB.

## idealItems

Scores items by how many of the given favorites they fulfill. See [[src/queries.ts#idealItems]].

Loops over each favorite, queries matching items, and accumulates counts. Duplicate favorites in the input increase the score for items that fulfill that favorite. Returns `ItemScore[]` omitting any items with zero matches.

## recommendedItemsForHouse

Queries flat tagged recommendation rows for a house's favorites. See [[src/queries.ts#recommendedItemsForHouse]].

Accepts `allFavorites: string[]` with duplicates preserved for score weighting. The query builds a `house_favorites` CTE with per-favorite counts, filters to tags in `('relaxation', 'decoration', 'toy')`, and returns one row per matching item ordered by weighted score descending, distinct covered-favorite count descending, and name ascending.

The SELECT list is assembled dynamically: for each distinct normalized favorite it adds a `MAX(CASE WHEN ...) AS "fav_<favorite>"` column. Each returned row therefore contains `ItemDetails` plus one boolean field per required favorite, which [[ui#House]] can render directly as table cells.

## recommendedItemsForHouseWithStatus

Queries the same flat tagged recommendation rows plus a redundancy flag. See [[src/queries.ts#recommendedItemsForHouseWithStatus]].

Accepts `allFavorites`, `fulfilledFavorites`, and `fulfilledTags`. SQLite computes `isRedundant` as true only when every favorite covered by the item is already fulfilled for the house and the item's tag is already represented, so Vue can split rows into active and already-covered sections without recomputing coverage sets.

## getItemPicturePath

Returns the `picture_path` for a single item by name. See [[src/queries.ts#getItemPicturePath]].

Case-insensitive lookup. Returns `null` if the item has no picture or is not found. Used by the cart store when a new item is first added.

## getRecipeForItem

Returns the crafting recipe for a single item as a `RecipeIngredient[]`. See [[src/queries.ts#getRecipeForItem]].

Each entry has `ingredientName`, `ingredientPicture`, and `count`. Items with no recipe return `[]`. Results are sorted by ingredient name. Cached per item in the cart store.

## getAggregatedIngredients

Aggregates crafting ingredients across all cart items, multiplied by their quantities. See [[src/queries.ts#getAggregatedIngredients]].

Accepts `Array<{ name, quantity }>`. Builds a UNION ALL query (one subquery per cart item) then groups by ingredient to SUM totals. Returns `AggregatedIngredient[]` with `name`, `picturePath`, and `total`, sorted by ingredient name. Returns `[]` for an empty cart.
