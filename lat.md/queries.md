# Queries

All SQLite read queries for `public/pokehousing.sqlite`. This is the single module that calls `getDb()` and `db.exec()`. Vue components and other modules must not contain SQL — they import from here instead. Lives in [[src/queries.ts]].

## loadPokemonData

Loads all pokemon with their image paths, habitats, and favorites from the database. See [[src/queries.ts#loadPokemonData]].

Returns a `PokemonData` record keyed by pokemon name, with each entry holding `image`, `favorites`, and `habitat`. Uses a `GROUP_CONCAT` of `pokemon_favorites` joined to `pokemon`.

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

## taggedItemsForHouseFavorites

Queries items filtered to tag IN ('relaxation', 'decoration', 'toy') that cover at least one favorite of the house's pokemon. See [[src/queries.ts#taggedItemsForHouseFavorites]].

Accepts `allFavorites: string[]` (with duplicates for score weighting). Runs one SQL query per unique favorite with a `LOWER(i.tag) IN (...)` filter. Returns `TaggedItemResult[]` — `ItemDetails` extended with `coveredFavorites: string[]` listing which house favorites each item covers. Used by [[items#clusterTaggedItemsForHouse]].

## getItemPicturePath

Returns the `picture_path` for a single item by name. See [[src/queries.ts#getItemPicturePath]].

Case-insensitive lookup. Returns `null` if the item has no picture or is not found. Used by the cart store when a new item is first added.

## getRecipeForItem

Returns the crafting recipe for a single item as a `RecipeIngredient[]`. See [[src/queries.ts#getRecipeForItem]].

Each entry has `ingredientName`, `ingredientPicture`, and `count`. Items with no recipe return `[]`. Results are sorted by ingredient name. Cached per item in the cart store.

## getAggregatedIngredients

Aggregates crafting ingredients across all cart items, multiplied by their quantities. See [[src/queries.ts#getAggregatedIngredients]].

Accepts `Array<{ name, quantity }>`. Builds a UNION ALL query (one subquery per cart item) then groups by ingredient to SUM totals. Returns `AggregatedIngredient[]` with `name`, `picturePath`, and `total`, sorted by ingredient name. Returns `[]` for an empty cart.
