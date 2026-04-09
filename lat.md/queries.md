# Queries

All SQLite read queries for `public/pokehousing.sqlite`. This is the single module that calls `getDb()` and `db.exec()`. Vue components and other modules must not contain SQL — they import from here instead. Lives in [[src/queries.ts]].

## loadPokemonData

Loads all pokemon with their image paths, habitats, and favorites from the database. See [[src/queries.ts#loadPokemonData]].

Returns a `PokemonData` record keyed by pokemon name, with each entry holding `image`, `favorites`, and `habitat`. Uses a `GROUP_CONCAT` of `pokemon_favorites` joined to `pokemon`.

## loadAdjacencyMap

Loads the precomputed pairwise compatibility scores from the `adjacency` table. See [[src/queries.ts#loadAdjacencyMap]].

Returns an `AdjacencyMap` (`Map<string, Map<string, number | null>>`). Entries are stored symmetrically (both directions). Called once on mount by HomeView and passed to the solver.

## itemsForFavorite

Looks up catalog item names for a single favorite. See [[src/queries.ts#itemsForFavorite]].

Case-insensitive lookup via normalized favorite name. Returns `string[]` in database order.

## favoritesForItem

Returns all favorites fulfilled by a single item. See [[src/queries.ts#favoritesForItem]].

Case-insensitive item name lookup; results are alphabetically sorted as returned by the DB.

## idealItems

Scores items by how many of the given favorites they fulfill. See [[src/queries.ts#idealItems]].

Loops over each favorite, queries matching items, and accumulates counts. Duplicate favorites in the input increase the score for items that fulfill that favorite. Returns `ItemScore[]` omitting any items with zero matches.
