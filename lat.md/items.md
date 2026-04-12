# Items

Functions about Pokopia items that can be used to fulfil Pokemon favorites when placed in households. SQL queries are centralized in [[queries]] — these functions contain only clustering and selection logic.

## Database schema

The `items` table has columns for id, name, category, picture_path, flavor_text, and tag (nullable).

The `tag` field contains Pokopia item tags (e.g., "Relaxation", "Toy", "Decoration") scraped from serebii.net via [[scripts/scrape-item-tags.js]].

## ItemDetails

The `ItemDetails` interface includes `name`, `isCraftable`, `category`, `flavorText`, `picturePath`, and `tag` (nullable). The `tag` field is displayed as an info-variant pill badge in all item displays.

Tag pills appear in the recommended items table ([[ui#House]]) and in shopping cart item rows ([[ui#ShoppingCart]]).

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

## Scraping item tags

[[scripts/scrape-item-tags.js]] populates the `tag` column by scraping all item pages from serebii.net. The script is resumable and rate-limited at 1500ms intervals.

It enumerates item URLs from the `<select name="SelectURL">` dropdown, fetches each page, parses the Category/Tag header row, and updates the database directly. Items that already have a non-null tag are skipped.
