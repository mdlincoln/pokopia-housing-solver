#!/usr/bin/env python3
"""Harvest missing items from Serebii's Pokopia item database into the local SQLite DB.

Scrapes Serebii's favorites-category list pages (43 pages) and the comprehensive
items listing to discover all items and their favorite-category mappings, compares
case-insensitively against the existing ``public/pokehousing.sqlite`` database,
then for each missing item fetches its detail page to extract the sprite image
URL, category, tag, flavor text, and crafting recipe. The sprite is downloaded
to ``public/images/`` and the item record + recipe + favorite mappings are
inserted into SQLite using a two-pass approach (all items first, then recipes
to satisfy foreign-key constraints).

Serebii data sources:
  - https://www.serebii.net/pokemonpokopia/favorites/blockystuff.shtml  (and 42 more)
  - https://www.serebii.net/pokemonpokopia/items.shtml
  - https://www.serebii.net/pokemonpokopia/items/<slug>.shtml  (per-item detail)

Usage:
  python3 scripts/harvest_items.py              # scrape + add missing items
  python3 scripts/harvest_items.py --dry-run    # report only, no writes
  python3 scripts/harvest_items.py --verify     # completeness + integrity check
"""

import argparse
import html
import os
import random
import re
import sqlite3
import time
import urllib.request
from collections import namedtuple

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FAVORITES_START_URL = (
    "https://www.serebii.net/pokemonpokopia/favorites/blockystuff.shtml"
)
ITEMS_LIST_URL = "https://www.serebii.net/pokemonpokopia/items.shtml"
DETAIL_URL_TMPL = "https://www.serebii.net/pokemonpokopia/items/{}.shtml"
IMAGE_BASE = "https://www.serebii.net"

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_DB_PATH = os.path.join(PROJECT_ROOT, "public", "pokehousing.sqlite")
DEFAULT_IMAGES_DIR = os.path.join(PROJECT_ROOT, "public", "images")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/137.0.0.0 Safari/537.36"
)

# Valid Pokopia item tags. Used for non-blocking warnings only — all tags from
# Serebii are stored as-is. The app's recommendation engine only filters on
# Relaxation/Decoration/Toy, but Road and Food are valid Serebii tags.
VALID_TAGS = {"Decoration", "Toy", "Relaxation", "Road", "Food"}

# ---------------------------------------------------------------------------
# Namedtuples
# ---------------------------------------------------------------------------

FavoriteCategory = namedtuple("FavoriteCategory", ["slug", "display_name"])
DiscoveredItem = namedtuple("DiscoveredItem", ["slug", "name", "source"])
RecipeIngredient = namedtuple("RecipeIngredient", ["slug", "name", "count"])
ItemDetail = namedtuple(
    "ItemDetail",
    [
        "slug",
        "name",
        "image_url",
        "image_filename",
        "category",
        "tag",
        "flavor_text",
        "recipe",
        "favorites",
    ],
)


# ---------------------------------------------------------------------------
# Network utilities
# ---------------------------------------------------------------------------


def fetch_page(url):
    """Fetch ``url`` and return its HTML as a string. Raises on non-200."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status != 200:
            raise RuntimeError(f"HTTP {resp.status} fetching {url}")
        data = resp.read()
        try:
            return data.decode("utf-8")
        except UnicodeDecodeError:
            return data.decode("latin-1")


def jittered_delay(base_delay):
    """Sleep for a jittered duration between ``base_delay`` and 3 seconds."""
    time.sleep(random.uniform(base_delay, 3.0))


# ---------------------------------------------------------------------------
# HTML helpers
# ---------------------------------------------------------------------------


def strip_tags(text):
    """Remove HTML tags from ``text`` and strip surrounding whitespace."""
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


# ---------------------------------------------------------------------------
# Phase 2: Discovery — favorites pages
# ---------------------------------------------------------------------------

# Matches <option value="/pokemonpokopia/favorites/<slug>.shtml"><Display Name></option>
FAVORITE_NAV_RE = re.compile(
    r'<option value="/pokemonpokopia/favorites/([^"]+)\.shtml">([^<]+)</option>'
)

# Matches item name links on favorites pages (absolute URL, with <u> tags).
# Tag column links use <img>/<br/> and are excluded by the <u> requirement.
FAVORITES_ITEM_RE = re.compile(
    r'<a href="/pokemonpokopia/items/([^"]+)\.shtml"><u>([^<]+)</u></a>'
)


def scrape_favorites_nav(base_delay):
    """Scrape the favorites navigation dropdown and return all category pages.

    Returns a list of ``FavoriteCategory`` namedtuples.
    """
    print(f"Fetching favorites navigation: {FAVORITES_START_URL}")
    page_html = fetch_page(FAVORITES_START_URL)

    seen = set()
    categories = []
    for slug, display_name in FAVORITE_NAV_RE.findall(page_html):
        if slug in seen:
            continue
        seen.add(slug)
        categories.append(
            FavoriteCategory(slug=slug, display_name=html.unescape(display_name))
        )

    jittered_delay(base_delay)
    print(f"Discovered {len(categories)} favorite category pages.")
    return categories


def scrape_favorites_page(fav_url, fav_display_name, base_delay):
    """Scrape a single favorites page; return list of (DiscoveredItem, favorite_name)."""
    page_html = fetch_page(fav_url)

    favorite_name = fav_display_name.lower()
    results = []
    for slug, raw_name in FAVORITES_ITEM_RE.findall(page_html):
        name = html.unescape(raw_name).strip()
        results.append((DiscoveredItem(slug, name, "favorites"), favorite_name))

    jittered_delay(base_delay)
    return results


def scrape_all_favorites_pages(base_delay, categories=None):
    """Scrape all 43 favorites pages.

    Returns ``(items_set, favorites_map, categories)`` where:
      - ``items_set`` is a set of DiscoveredItem (deduplicated by slug)
      - ``favorites_map`` is a dict mapping slug -> set of favorite_name (lowercase)
      - ``categories`` is the list of FavoriteCategory namedtuples

    If ``categories`` is provided (e.g. from a prior scrape_favorites_nav call),
    those are used instead of re-scraping the nav page.
    """
    if categories is None:
        categories = scrape_favorites_nav(base_delay)

    items_by_slug = {}
    favorites_map = {}

    print(f"\nScraping {len(categories)} favorites pages...")
    for i, cat in enumerate(categories, 1):
        fav_url = f"https://www.serebii.net/pokemonpokopia/favorites/{cat.slug}.shtml"
        print(f"  [{i}/{len(categories)}] {cat.display_name} ({cat.slug})")
        results = scrape_favorites_page(fav_url, cat.display_name, base_delay)
        for item, fav_name in results:
            if item.slug not in items_by_slug:
                items_by_slug[item.slug] = item
            if item.slug not in favorites_map:
                favorites_map[item.slug] = set()
            favorites_map[item.slug].add(fav_name)

    print(
        f"\nDiscovered {len(items_by_slug)} unique items across "
        f"{len(categories)} favorites pages."
    )
    return set(items_by_slug.values()), favorites_map, categories


# ---------------------------------------------------------------------------
# Phase 3: Discovery — comprehensive items listing
# ---------------------------------------------------------------------------

# Matches item links on the items.shtml listing (relative URL, with <u> tags).
LIST_ITEM_RE = re.compile(
    r'<a href="items/([^"]+)\.shtml"><u>([^<]+)</u></a>'
)


def scrape_items_listing(base_delay):
    """Scrape the comprehensive items listing; return a set of DiscoveredItem."""
    print(f"\nFetching items listing: {ITEMS_LIST_URL}")
    page_html = fetch_page(ITEMS_LIST_URL)

    items_by_slug = {}
    for slug, raw_name in LIST_ITEM_RE.findall(page_html):
        if slug in items_by_slug:
            continue
        name = html.unescape(raw_name).strip()
        items_by_slug[slug] = DiscoveredItem(slug, name, "listing")

    jittered_delay(base_delay)
    print(f"Discovered {len(items_by_slug)} unique items from the listing page.")
    return set(items_by_slug.values())


# ---------------------------------------------------------------------------
# Phase 4: Comparison
# ---------------------------------------------------------------------------


def get_existing_items(db_path):
    """Return ``(names_lower_set, name_map, slug_map)`` from the DB.

      - ``names_lower``: set of lowercased item names
      - ``name_map``: dict mapping name_lower -> original DB name
      - ``slug_map``: dict mapping slug (from picture_path) -> item_id
    """
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cur = conn.execute("SELECT id, name, picture_path FROM items")
        rows = cur.fetchall()

        names_lower = set()
        name_map = {}
        slug_map = {}

        for item_id, name, picture_path in rows:
            names_lower.add(name.lower())
            name_map[name.lower()] = name
            if picture_path:
                # picture_path = "images/<slug>.png"
                filename = picture_path.replace("images/", "")
                slug = filename.rsplit(".", 1)[0]  # strip ".png"
                slug_map[slug] = item_id
    finally:
        conn.close()

    return names_lower, name_map, slug_map


def find_missing_items(all_serebii_items, existing_names_lower):
    """Return list of DiscoveredItem not present in the DB (case-insensitive)."""
    missing = []
    for item in all_serebii_items:
        if item.name.lower() not in existing_names_lower:
            missing.append(item)
    return missing


# ---------------------------------------------------------------------------
# Phase 5: Detail page scraping
# ---------------------------------------------------------------------------

ITEM_NAME_RE = re.compile(r"<h1>([^<]+)</h1>", re.IGNORECASE)

ITEM_IMG_RE = re.compile(
    r'<td class="pkmn"><img src="([^"]+)"', re.IGNORECASE
)

# Block between the Category header and the Trade Value header. Within this
# block, the values row has multiple <td class="cen"> cells: the first is
# Category, the second is Tag.
CAT_TAG_BLOCK_RE = re.compile(
    r'<td class="fooevo"[^>]*>Category</td>(.*?)(?:<td class="fooevo"[^>]*>Trade Value)',
    re.DOTALL | re.IGNORECASE,
)

# All <td class="cen"> cells within the Category→Trade Value block.
CEN_CELL_RE = re.compile(
    r'<td class="cen">(.*?)</td>', re.DOTALL | re.IGNORECASE,
)

# Flavor text: between <h2>Flavor Text</h2> and the next </table> or <h2>.
FLAVOR_TEXT_RE = re.compile(
    r"<h2>Flavor Text</h2>(.*?)(?:<h2>|</table>|$)",
    re.DOTALL | re.IGNORECASE,
)

# Favorite Categories on detail page: the cell with colspan="2" that follows
# the "Favorite Categories" label.  The Trade Value / 3D Print Cost cells (also
# <td class="cen">) come before it, so we need colspan=2 to disambiguate.
DETAIL_FAVORITES_RE = re.compile(
    r'Favorite Categories</td>.*?'
    r'<td class="cen"[^>]*colspan="2"[^>]*>(.*?)</td>',
    re.DOTALL | re.IGNORECASE,
)

# Favourite links inside the detail page Favorite Categories cell.
FAV_LINK_RE = re.compile(
    r'<a href="/pokemonpokopia/favorites/([^"]+)\.shtml"><u>([^<]+)</u></a>'
)

# Recipe section: between <h2>Recipe</h2> and the next <h2> or end.
RECIPE_SECTION_RE = re.compile(
    r"<h2>Recipe</h2>(.*?)(?:<h2>|$)",
    re.DOTALL | re.IGNORECASE,
)

# Recipe ingredient rows: <a href="<slug>.shtml"><u>Name</u></a> * N
RECIPE_ITEM_RE = re.compile(
    r'<a href="([^"]+)\.shtml"><u>([^<]+)</u></a>\s*\*\s*(\d+)',
    re.IGNORECASE,
)


def scrape_item_detail(slug, base_delay):
    """Fetch ``slug``'s detail page and extract all metadata.

    Returns an ``ItemDetail`` namedtuple, or ``None`` on extraction failure
    or fetch error.
    """
    url = DETAIL_URL_TMPL.format(slug)
    try:
        page_html = fetch_page(url)
    except Exception as e:
        print(f"  ERROR fetching detail page for '{slug}': {e}")
        return None

    # --- Name ---
    name = slug  # fallback
    name_match = ITEM_NAME_RE.search(page_html)
    if name_match:
        name = html.unescape(name_match.group(1)).strip()

    # --- Image URL ---
    image_url = None
    img_match = ITEM_IMG_RE.search(page_html)
    if img_match:
        image_url = img_match.group(1)

    image_filename = None
    if image_url:
        image_filename = image_url.rsplit("/", 1)[-1]

    # --- Category ---
    category = None
    block_match = CAT_TAG_BLOCK_RE.search(page_html)
    if block_match:
        block = block_match.group(1)
        cen_cells = CEN_CELL_RE.findall(block)
        if cen_cells:
            category = strip_tags(html.unescape(cen_cells[0]))
            if not category:
                category = None

    # --- Tag ---
    tag = None
    if block_match:
        cen_cells = CEN_CELL_RE.findall(block_match.group(1))
        if len(cen_cells) > 1:
            tag = strip_tags(html.unescape(cen_cells[1]))
            if not tag or tag == "\xa0":
                tag = None

    # --- Flavor Text ---
    flavor_text = None
    ft_match = FLAVOR_TEXT_RE.search(page_html)
    if ft_match:
        flavor_text = strip_tags(html.unescape(ft_match.group(1)))
        if not flavor_text:
            flavor_text = None

    # --- Recipe ---
    recipe = []
    recipe_match = RECIPE_SECTION_RE.search(page_html)
    if recipe_match:
        recipe_section = recipe_match.group(1)
        for ing_slug, raw_name, count in RECIPE_ITEM_RE.findall(recipe_section):
            ing_name = html.unescape(raw_name).strip()
            recipe.append(
                RecipeIngredient(slug=ing_slug, name=ing_name, count=int(count))
            )

    # --- Favorite Categories (supplementary) ---
    favorites = []
    fav_section_match = DETAIL_FAVORITES_RE.search(page_html)
    if fav_section_match:
        fav_section = fav_section_match.group(1)
        for _fav_slug, fav_name in FAV_LINK_RE.findall(fav_section):
            favorites.append(html.unescape(fav_name).strip())

    # --- Validation ---
    if image_url is None or category is None:
        print(
            f"  WARNING: incomplete extraction for '{slug}': "
            f"image_url={image_url}, category={category}, tag={tag}"
        )
        return None

    detail = ItemDetail(
        slug=slug,
        name=name,
        image_url=image_url,
        image_filename=image_filename,
        category=category,
        tag=tag,
        flavor_text=flavor_text,
        recipe=recipe,
        favorites=favorites,
    )
    jittered_delay(base_delay)
    return detail


# ---------------------------------------------------------------------------
# Phase 6: Image download
# ---------------------------------------------------------------------------


def download_item_image(image_url, dest_filename, images_dir, db_path, base_delay):
    """Download the sprite to ``images_dir/dest_filename``.

    Collision check: if the file already exists and a DB item references it,
    skip. If the file exists but no item references it, overwrite (stale).

    Returns the DB-bound image_path value ``images/<dest_filename>``.
    """
    dest_path = os.path.join(images_dir, dest_filename)
    db_image_path = f"images/{dest_filename}"

    if os.path.exists(dest_path):
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            cur = conn.execute(
                "SELECT COUNT(*) FROM items WHERE picture_path = ?", (db_image_path,)
            )
            count = cur.fetchone()[0]
        finally:
            conn.close()
        if count > 0:
            print(f"    Image already present and referenced: {db_image_path} (skip)")
            return db_image_path
        else:
            print(f"    Stale file exists, overwriting: {dest_path}")

    # Build full URL for the image.
    if image_url.startswith("http"):
        full_url = image_url
    else:
        full_url = IMAGE_BASE + image_url

    req = urllib.request.Request(full_url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status != 200:
            raise RuntimeError(f"HTTP {resp.status} fetching image {full_url}")
        image_bytes = resp.read()

    with open(dest_path, "wb") as f:
        f.write(image_bytes)
    print(f"    Downloaded image: {dest_path} ({len(image_bytes)} bytes)")
    jittered_delay(base_delay)
    return db_image_path


# ---------------------------------------------------------------------------
# Phase 7: DB insertion (two-pass)
# ---------------------------------------------------------------------------


def add_item_to_db(db_path, name, image_path, category, tag, flavor_text):
    """Insert an item record (metadata only, no recipe/favorites).

    Returns the new item_id.
    """
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        # Tag validation (non-blocking warning).
        if tag is not None and tag not in VALID_TAGS:
            print(f"    WARNING: tag '{tag}' not in VALID_TAGS; storing as-is")

        cur = conn.execute(
            "INSERT INTO items (id, name, category, picture_path, flavor_text, tag) "
            "VALUES (NULL, ?, ?, ?, ?, ?)",
            (name, category, image_path, flavor_text, tag),
        )
        item_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()
    return item_id


def add_recipe_for_item(db_path, item_id, recipe, slug_map):
    """Insert recipe rows for a single item.

    ``slug_map`` maps ingredient slug -> item_id. Ingredients not found in
    the map are warned about and skipped (FK constraint would fail).
    """
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        for ingredient in recipe:
            ing_id = slug_map.get(ingredient.slug)
            if ing_id is None:
                print(
                    f"    WARNING: recipe ingredient '{ingredient.name}' "
                    f"(slug '{ingredient.slug}') not in DB; skipping recipe row"
                )
                continue
            conn.execute(
                "INSERT OR IGNORE INTO item_recipe "
                "(item_id, ingredient_id, COUNT) VALUES (?, ?, ?)",
                (item_id, ing_id, ingredient.count),
            )
        conn.commit()
    finally:
        conn.close()


def add_favorites_for_item(db_path, item_id, favorite_names, existing_fav_lower):
    """Insert item_favorites rows for a single item.

    ``favorite_names`` is an iterable of favorite display names (will be lowercased).
    ``existing_fav_lower`` is the set of lowercased favorite names in the DB.
    """
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        for fav in favorite_names:
            fav_lower = fav.lower()
            if fav_lower not in existing_fav_lower:
                print(
                    f"    WARNING: favorite '{fav}' not in favorites table; "
                    f"skipping item_favorites entry"
                )
                continue
            conn.execute(
                "INSERT OR IGNORE INTO item_favorites "
                "(item_id, favorite_name) VALUES (?, ?)",
                (item_id, fav_lower),
            )
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Phase 8: Backfill favorites and recipes for existing items
# ---------------------------------------------------------------------------


def backfill_favorites(
    db_path, favorites_map, slug_map, existing_fav_lower
):
    """Backfill item_favorites for existing items discovered on favorites pages.

    ``favorites_map`` maps slug -> set of favorite_name (lowercase).
    ``slug_map`` maps slug -> item_id.
    """
    print("\n--- Backfilling favorites for existing items ---")

    # Build a name_lower -> item_id map for fallback lookups.
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cur = conn.execute("SELECT id, name FROM items")
        name_lower_to_id = {name.lower(): item_id for item_id, name in cur.fetchall()}
    finally:
        conn.close()

    backfilled = 0
    for slug, fav_names in favorites_map.items():
        # Look up item_id: try slug_map first, then name-based lookup.
        item_id = slug_map.get(slug)
        if item_id is None:
            # Try to find by name using the slug as a name candidate.
            # This handles items whose picture_path slug differs.
            item_id = name_lower_to_id.get(slug.replace("-", " "))
            if item_id is None:
                continue

        # Get existing favorites for this item.
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            cur = conn.execute(
                "SELECT favorite_name FROM item_favorites WHERE item_id = ?",
                (item_id,),
            )
            existing = {row[0] for row in cur.fetchall()}

            for fav in fav_names:
                if fav not in existing_fav_lower:
                    continue  # skip favorites not in DB
                if fav in existing:
                    continue  # already mapped
                conn.execute(
                    "INSERT OR IGNORE INTO item_favorites "
                    "(item_id, favorite_name) VALUES (?, ?)",
                    (item_id, fav),
                )
                backfilled += 1
            conn.commit()
        finally:
            conn.close()

    print(f"Backfilled {backfilled} item_favorites entries.")


def backfill_recipes(db_path, slug_map, base_delay):
    """Backfill recipes for existing items that lack them (crash recovery)."""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cur = conn.execute(
            "SELECT i.id, i.name, i.picture_path FROM items i "
            "WHERE NOT EXISTS (SELECT 1 FROM item_recipe r WHERE r.item_id = i.id)"
        )
        items_without_recipes = cur.fetchall()
    finally:
        conn.close()

    if not items_without_recipes:
        print("\n--- Recipe backfill: all items already have recipes (or none) ---")
        return

    print(
        f"\n--- Backfilling recipes for {len(items_without_recipes)} "
        f"items without recipes ---"
    )

    # Refresh slug_map to include newly inserted items.
    _, _, fresh_slug_map = get_existing_items(db_path)
    slug_map.update(fresh_slug_map)

    backfilled = 0
    skipped = 0
    for item_id, name, picture_path in items_without_recipes:
        if not picture_path:
            skipped += 1
            continue

        # Derive slug from picture_path.
        filename = picture_path.replace("images/", "")
        slug = filename.rsplit(".", 1)[0]

        detail = scrape_item_detail(slug, base_delay)
        if detail is None:
            skipped += 1
            continue

        if not detail.recipe:
            skipped += 1
            continue

        add_recipe_for_item(db_path, item_id, detail.recipe, slug_map)
        print(f"  Backfilled recipe for '{name}' ({len(detail.recipe)} ingredients)")
        backfilled += 1

    print(f"Recipe backfill: {backfilled} updated, {skipped} skipped (no recipe).")


# ---------------------------------------------------------------------------
# Phase 9: Verification
# ---------------------------------------------------------------------------


def verify_items_completeness(db_path, all_serebii_items, images_dir, serebii_favorites):
    """Check DB items set vs Serebii list + run data-integrity assertions.

    Returns ``True`` if complete and no integrity violations.
    """
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cur = conn.execute("SELECT name FROM items")
        db_names_lower = {r[0].lower() for r in cur.fetchall()}

        cur = conn.execute("SELECT name FROM favorites")
        valid_favorites = {r[0] for r in cur.fetchall()}

        cur = conn.execute("SELECT id, name, picture_path FROM items")
        all_items = cur.fetchall()

        cur = conn.execute("SELECT item_id, favorite_name FROM item_favorites")
        if_rows = cur.fetchall()

        cur = conn.execute("SELECT item_id, ingredient_id FROM item_recipe")
        recipe_rows = cur.fetchall()

        cur = conn.execute("SELECT id FROM items")
        valid_item_ids = {r[0] for r in cur.fetchall()}
    finally:
        conn.close()

    serebii_names_lower = {e.name.lower() for e in all_serebii_items}
    missing = serebii_names_lower - db_names_lower
    extra = db_names_lower - serebii_names_lower

    print("\n" + "=" * 60)
    print("VERIFICATION REPORT")
    print("=" * 60)
    print(f"Serebii unique items: {len(serebii_names_lower)}")
    print(f"DB items count:       {len(db_names_lower)}")
    if missing:
        print(f"\nMISSING from DB ({len(missing)}):")
        for name in sorted(missing):
            print(f"  - {name}")
    else:
        print("\nMissing from DB: none")
    if extra:
        print(f"\nExtra in DB (not on Serebii, {len(extra)}):")
        for name in sorted(extra):
            print(f"  + {name}")
    else:
        print("Extra in DB: none")

    # --- Integrity assertions ---
    violations = []

    # 1. Every item has non-null picture_path
    for item_id, name, picture_path in all_items:
        if picture_path is None or picture_path == "":
            violations.append(f"item '{name}' (id={item_id}) has null/empty picture_path")

    # 2. Every item_favorites entry has valid item_id and favorite_name FKs
    for item_id, fav_name in if_rows:
        if item_id not in valid_item_ids:
            violations.append(
                f"item_favorites orphan: item_id={item_id} not in items table"
            )
        if fav_name not in valid_favorites:
            violations.append(
                f"item_favorites orphan (item_id={item_id}): favorite_name "
                f"'{fav_name}' not in favorites table"
            )

    # 3. Every item_recipe entry has valid item_id and ingredient_id FKs
    for item_id, ingredient_id in recipe_rows:
        if item_id not in valid_item_ids:
            violations.append(
                f"item_recipe orphan: item_id={item_id} not in items table"
            )
        if ingredient_id not in valid_item_ids:
            violations.append(
                f"item_recipe orphan: ingredient_id={ingredient_id} not in items table "
                f"(for item_id={item_id})"
            )

    # 4. Every picture_path file exists on disk
    for item_id, name, picture_path in all_items:
        if picture_path:
            local_file = os.path.join(
                images_dir, picture_path.replace("images/", "")
            )
            if not os.path.exists(local_file):
                violations.append(
                    f"item '{name}': image file missing on disk: {local_file}"
                )

    # 5. Every favorite in favorites table matches a Serebii favorite category
    serebii_fav_lower = {f.lower() for f in serebii_favorites}
    for fav in valid_favorites:
        if fav.lower() not in serebii_fav_lower:
            violations.append(
                f"favorites table entry '{fav}' has no Serebii favorite category match"
            )

    if violations:
        print(f"\nINTEGRITY VIOLATIONS ({len(violations)}):")
        for v in violations:
            print(f"  ! {v}")
    else:
        print("\nIntegrity: OK (no violations)")

    ok = (len(missing) == 0) and (len(violations) == 0)
    print("=" * 60)
    print(f"Result: {'PASS' if ok else 'FAIL'}")
    print("=" * 60)
    return ok


# ---------------------------------------------------------------------------
# Phase 10: CLI / main
# ---------------------------------------------------------------------------


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Harvest missing items from Serebii's Pokopia item database."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Scrape and report what would be added, but do not write.",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Skip harvesting; run the completeness + integrity check only.",
    )
    parser.add_argument(
        "--db",
        default=DEFAULT_DB_PATH,
        help=f"Path to the SQLite DB (default: {DEFAULT_DB_PATH})",
    )
    parser.add_argument(
        "--images-dir",
        default=DEFAULT_IMAGES_DIR,
        help=f"Directory for sprite images (default: {DEFAULT_IMAGES_DIR})",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.5,
        help="Base request delay in seconds; actual delay is jittered to [delay, 3.0].",
    )
    args = parser.parse_args(argv)

    db_path = os.path.abspath(args.db)
    images_dir = os.path.abspath(args.images_dir)
    base_delay = args.delay

    # --- Verify-only mode ---
    if args.verify:
        print("Running in verify-only mode.\n")
        # Scrape favorites nav + items listing for comparison.
        fav_categories = scrape_favorites_nav(base_delay)
        serebii_favorites = [cat.display_name for cat in fav_categories]
        all_fav_items, _fav_map, _cats = scrape_all_favorites_pages(
            base_delay, categories=fav_categories
        )
        listing_items = scrape_items_listing(base_delay)

        # Merge: deduplicate by slug, prefer listing name.
        merged = {}
        for item in all_fav_items:
            merged[item.slug] = item
        for item in listing_items:
            merged[item.slug] = item  # listing overrides favorites
        all_items = set(merged.values())

        verify_items_completeness(db_path, all_items, images_dir, serebii_favorites)
        return

    # --- Harvest mode (dry-run or real) ---
    print("Fetching Serebii favorites pages...")
    all_fav_items, favorites_map, fav_categories = scrape_all_favorites_pages(base_delay)
    serebii_favorites = [cat.display_name for cat in fav_categories]

    listing_items = scrape_items_listing(base_delay)

    # Merge discoveries: deduplicate by slug, prefer listing name.
    merged = {}
    for item in all_fav_items:
        merged[item.slug] = item
    for item in listing_items:
        merged[item.slug] = item
    all_items = set(merged.values())

    existing_names_lower, existing_name_map, slug_map = get_existing_items(db_path)

    # Get existing favorites from DB for FK validation.
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cur = conn.execute("SELECT name FROM favorites")
        existing_fav_lower = {r[0].lower() for r in cur.fetchall()}
    finally:
        conn.close()

    missing = find_missing_items(all_items, existing_names_lower)
    existing_count = len(all_items) - len(missing)

    print(
        f"\nFound {len(all_items)} items on Serebii, "
        f"{existing_count} already in DB, {len(missing)} to add."
    )

    if not missing and not args.dry_run:
        print("Nothing to add. Running verification...")
        verify_items_completeness(
            db_path, all_items, images_dir, serebii_favorites
        )
        return

    if not missing and args.dry_run:
        print("[DRY RUN] No missing items found.")
        return

    # --- Dry run ---
    if args.dry_run:
        print(f"\n[DRY RUN] Would add {len(missing)} items:\n")
        for i, entry in enumerate(missing, 1):
            try:
                detail = scrape_item_detail(entry.slug, base_delay)
            except Exception as e:
                print(f"  [{i}/{len(missing)}] ERROR scraping '{entry.name}': {e}")
                continue
            if detail is None:
                print(
                    f"  [{i}/{len(missing)}] DRY RUN: would add {entry.name} "
                    f"(EXTRACTION FAILED — see warnings above)"
                )
                continue

            favs = favorites_map.get(entry.slug, set())
            print(
                f"  [{i}/{len(missing)}] DRY RUN: would add {detail.name}\n"
                f"    slug={entry.slug}\n"
                f"    category={detail.category}\n"
                f"    tag={detail.tag}\n"
                f"    flavor_text={detail.flavor_text}\n"
                f"    recipe={detail.recipe}\n"
                f"    favorites={sorted(favs)}"
            )
        print("\n[DRY RUN complete — no writes performed.]")
        return

    # --- Real harvest ---
    os.makedirs(images_dir, exist_ok=True)

    # Pass 1: insert all new items (metadata only).
    print(f"\nHarvesting {len(missing)} items (Pass 1: item metadata)...\n")
    inserted_details = []  # list of (item_id, ItemDetail) for Pass 2
    added = 0
    failed = 0

    for i, entry in enumerate(missing, 1):
        try:
            detail = scrape_item_detail(entry.slug, base_delay)
            if detail is None:
                print(f"  [{i}/{len(missing)}] SKIP '{entry.name}': extraction failed")
                failed += 1
                continue

            # Download image.
            image_path = download_item_image(
                detail.image_url,
                detail.image_filename,
                images_dir,
                db_path,
                base_delay,
            )

            # Insert item metadata.
            item_id = add_item_to_db(
                db_path,
                detail.name,
                image_path,
                detail.category,
                detail.tag,
                detail.flavor_text,
            )
            slug_map[entry.slug] = item_id

            inserted_details.append((item_id, detail))

            print(
                f"  [{i}/{len(missing)}] Added {detail.name} "
                f"(category={detail.category}, tag={detail.tag})"
            )
            added += 1
        except Exception as e:
            print(f"  [{i}/{len(missing)}] ERROR adding '{entry.name}': {e}")
            failed += 1
            continue

    # Pass 2: insert recipes and favorites for newly inserted items.
    print(
        f"\nPass 2: inserting recipes and favorites for {len(inserted_details)} "
        f"new items...\n"
    )
    for item_id, detail in inserted_details:
        # Recipe.
        if detail.recipe:
            add_recipe_for_item(db_path, item_id, detail.recipe, slug_map)

        # Favorites: combine favorites-page mappings with detail-page favorites.
        fav_names = set()
        if detail.slug in favorites_map:
            fav_names.update(favorites_map[detail.slug])
        fav_names.update(detail.favorites)

        if fav_names:
            add_favorites_for_item(db_path, item_id, fav_names, existing_fav_lower)

    # Backfill favorites for existing items discovered on favorites pages.
    backfill_favorites(db_path, favorites_map, slug_map, existing_fav_lower)

    # Backfill recipes for existing items lacking them (crash recovery).
    backfill_recipes(db_path, slug_map, base_delay)

    # --- Verification ---
    print(
        f"\nHarvest complete: added={added}, failed={failed}, "
        f"total on Serebii={len(all_items)}"
    )
    verify_items_completeness(db_path, all_items, images_dir, serebii_favorites)


if __name__ == "__main__":
    main()
