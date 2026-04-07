# Items

Functions about Pokopia items that can be used to fulfil Pokemon favorites when placed in households.

## idealItems

Maps a household's shared favorites to the best furniture items. See [[src/items.ts#idealItems]].

Given a `string[]` of favorites, looks up every item in `public/items_by_favorite.json` that fulfills at least one of those favorites and returns an `{item, score}[]` array where score is the number of input favorites fulfilled. Duplicate favorites in the input multiply item scores. Items fulfilling zero input favorites are omitted.

## itemsForFavorite

Looks up the catalog entries for one favorite name using a case-insensitive key. See [[src/items.ts#itemsForFavorite]].

This helper returns a `string[]` list of items in catalog order and is used by the UI modal that opens from favorite pills.

## clusterItemsByFavorites

Builds interchangeable item clusters keyed by the exact favorites each item fulfills. See [[src/items.ts#clusterItemsByFavorites]].

Given a favorite list, it deduplicates favorites case-insensitively, groups items by the sorted set of fulfilled favorites, and returns `ItemCluster[]` ranked by favorite coverage descending. Coverage ties are broken alphabetically by cluster favorite key for deterministic output.

## selectTopNonOverlappingClusters

Chooses up to three clusters that maximize total covered favorites without any overlap between selected clusters. See [[src/items.ts#selectTopNonOverlappingClusters]].

The selector enforces pairwise-disjoint favorites across chosen clusters, maximizing household coverage under that constraint. If multiple selections have equal coverage, it uses deterministic tie-breaks to keep stable results.
