// Favorite → Bootstrap Icons glyph mapping. Keys are the exact favorite names
// that appear in the baked pokemon catalog (see scripts/build_data.mjs), so the
// pokemon-favorites render surface and the HouseRecord `fav_*` column headers
// (both driven by pokemonData[name].favorites) resolve through this map.
// Values are bootstrap-icons kebab names WITHOUT the `bi-` prefix; the SVG
// markup for each is bundled via Vite `?raw` imports in src/iconSvg.ts.
//
// All keys are quoted (not bare identifiers) so a future favorite whose name is
// a JS reserved word (e.g. `class`, `default`) is still a valid object key.
//
// Fail-fast guard: src/__tests__/favoriteIcons.spec.ts asserts the union of all
// baked favorites is exactly the set of keys here, so a future harvest that
// adds or renames a favorite fails the suite until a mapping row (and its
// `?raw` import in src/iconSvg.ts) is added.

export const FAVORITE_ICONS: Readonly<Record<string, string>> = {
  'blocky stuff': 'box-fill',
  cleanliness: 'stars',
  'colorful stuff': 'rainbow',
  'complicated stuff': 'diagram-3',
  construction: 'hammer',
  containers: 'basket',
  'cute stuff': 'emoji-heart-eyes',
  electronics: 'cpu',
  exercise: 'heart-pulse',
  fabric: 'scissors',
  garbage: 'trash-fill',
  gatherings: 'people-fill',
  'glass stuff': 'measuring-cup',
  'group activities': 'controller',
  'hard stuff': 'diamond',
  healing: 'bandaid',
  'letters and words': 'alphabet',
  'looks like food': 'fork-knife',
  'lots of dirt': 'bucket',
  'lots of fire': 'fire',
  'lots of nature': 'leaf-fill',
  'lots of water': 'water',
  luxury: 'trophy-fill',
  'metal stuff': 'nut-fill',
  'nice breezes': 'wind',
  'noisy stuff': 'volume-up-fill',
  'ocean vibes': 'tsunami',
  'play spaces': 'puzzle-fill',
  'pretty flowers': 'flower1',
  rides: 'car-front',
  'round stuff': 'circle-fill',
  'sharp stuff': 'cone',
  'shiny stuff': 'gem',
  'slender objects': 'pencil',
  'soft stuff': 'feather',
  'spinning stuff': 'fan',
  'spooky stuff': 'mask',
  'stone stuff': 'bricks',
  'strange stuff': 'magic',
  symbols: 'asterisk',
  'watching stuff': 'binoculars-fill',
  'wobbly stuff': 'activity',
  'wooden stuff': 'tree-fill',
}

export function iconForFavorite(favorite: string): string | undefined {
  return FAVORITE_ICONS[favorite]
}
