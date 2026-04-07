# Items

Functions about Pokopia items that can be used to fulfil Pokemon favorites when placed in households.

## idealItems

Maps a household's shared favorites to the best furniture items. See [[src/items.ts#idealItems]].

Given a `string[]` of favorites, looks up every item in `public/items_by_favorite.json` that fulfills at least one of those favorites and returns an `{item, score}[]` array where score is the number of input favorites fulfilled. Duplicate favorites in the input multiply item scores. Items fulfilling zero input favorites are omitted.
