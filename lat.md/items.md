# Items

Functions about Pokopia items that can be used to fulfil Pokemon favorites when placed in households. SQL queries are centralized in [[queries]] — these functions contain only clustering and selection logic.

## idealItems

Maps a household's shared favorites to the best furniture items. See [[src/queries.ts#idealItems]].

Given a `string[]` of favorites, queries the SQLite database (`public/pokehousing.sqlite` via [[queries]]) for every item that fulfills at least one of those favorites and returns an `{item, score}[]` array where score is the number of input favorites fulfilled. Duplicate favorites in the input multiply item scores. Items fulfilling zero input favorites are omitted.

## itemsForFavorite

Looks up the catalog entries for one favorite name using a case-insensitive key. See [[src/queries.ts#itemsForFavorite]].

Returns `ItemDetails[]` (name, isCraftable, category, flavorText) in database order. Re-exported from queries via this module and used by the UI modal and `clusterItemsByFavorites`.

## favoritesForItem

Returns all favorites fulfilled by one item using a precomputed reverse index. See [[src/queries.ts#favoritesForItem]].

Queries the SQLite database for the favorites associated with a given item. Input is case-insensitive (lowercased before querying); output favorites are in alphabetically sorted order as returned by the DB.

## clusterItemsByFavorites

Builds interchangeable item clusters keyed by the exact favorites each item fulfills. See [[src/items.ts#clusterItemsByFavorites]].

Given a favorite list, it deduplicates favorites case-insensitively, groups items by the sorted set of fulfilled favorites, and returns `ItemCluster[]` ranked by favorite coverage descending. Coverage ties are broken alphabetically by cluster favorite key. Each cluster's `items` is `ItemDetails[]` — carrying craftable status, category, and flavor text from the DB query.

## selectTopNonOverlappingClusters

Chooses up to three clusters that maximize total covered favorites without any overlap between selected clusters. See [[src/items.ts#selectTopNonOverlappingClusters]].

The selector enforces pairwise-disjoint favorites across chosen clusters, maximizing household coverage under that constraint. If multiple selections have equal coverage, it uses deterministic tie-breaks to keep stable results.
