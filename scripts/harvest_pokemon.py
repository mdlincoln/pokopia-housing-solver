#!/usr/bin/env python3
"""Harvest missing Pokemon from Serebii's Pokopia Pokedex into the local SQLite DB.

Scrapes Serebii's Pokopia Pokedex list pages to discover all pokemon detail-page
URLs and display names, compares case-insensitively against the existing
``public/pokehousing.sqlite`` database, then for each missing pokemon fetches its
detail page to extract the sprite image URL, ideal habitat, and favorites. The
sprite is downloaded to ``public/images/`` and the pokemon record + favorites are
inserted into SQLite.

Serebii data sources:
  - https://www.serebii.net/pokemonpokopia/availablepokemon.shtml
  - https://www.serebii.net/pokemonpokopia/eventpokedex.shtml
  - https://www.serebii.net/pokemonpokopia/basinpokedex.shtml

Usage:
  python3 scripts/harvest_pokemon.py              # scrape + add missing pokemon
  python3 scripts/harvest_pokemon.py --dry-run    # report only, no writes
  python3 scripts/harvest_pokemon.py --verify     # completeness + integrity check
"""

import argparse
import html
import os
import random
import re
import sqlite3
import sys
import time
import urllib.request
from collections import namedtuple

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

LIST_PAGES = [
    "https://www.serebii.net/pokemonpokopia/availablepokemon.shtml",
    "https://www.serebii.net/pokemonpokopia/eventpokedex.shtml",
    "https://www.serebii.net/pokemonpokopia/basinpokedex.shtml",
]

DETAIL_URL_TMPL = "https://www.serebii.net/pokemonpokopia/pokedex/{}.shtml"
IMAGE_BASE = "https://www.serebii.net"

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_DB_PATH = os.path.join(PROJECT_ROOT, "public", "pokehousing.sqlite")
DEFAULT_IMAGES_DIR = os.path.join(PROJECT_ROOT, "public", "images")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/137.0.0.0 Safari/537.36"
)

# Valid habitat values (sourced from the habitats table at runtime).
VALID_HABITATS = {"Bright", "Cool", "Dark", "Dry", "Humid", "Warm"}

PokemonEntry = namedtuple("PokemonEntry", ["slug", "name"])
PokemonDetail = namedtuple(
    "PokemonDetail",
    ["slug", "name", "image_url", "image_filename", "habitat", "favorites"],
)


# ---------------------------------------------------------------------------
# Network
# ---------------------------------------------------------------------------


def fetch_page(url):
    """Fetch ``url`` and return its HTML as a string. Raises on non-200 or timeout."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status != 200:
            raise RuntimeError(f"HTTP {resp.status} fetching {url}")
        data = resp.read()
        # Serebii pages are latin-1 / windows-1252 encoded (traditional).
        try:
            return data.decode("utf-8")
        except UnicodeDecodeError:
            return data.decode("latin-1")


def jittered_delay(base_delay):
    """Sleep for a jittered duration between ``base_delay`` and 3 seconds."""
    time.sleep(random.uniform(base_delay, 3.0))


# ---------------------------------------------------------------------------
# Phase 1: List-page scraper
# ---------------------------------------------------------------------------

# Matches <a href="/pokemonpokopia/pokedex/<slug>.shtml"><u><Name></u></a>
LIST_LINK_RE = re.compile(
    r'<a href="/pokemonpokopia/pokedex/([^"]+)\.shtml"><u>([^<]+)</u></a>'
)
# Sub-paths to filter out (these are navigation links, not pokemon).
SKIP_SLUG_PREFIXES = ("specialty", "idealhabitat")


def scrape_pokemon_list(base_delay):
    """Scrape all list pages. Returns a list of ``PokemonEntry`` namedtuples."""
    seen_slugs = set()
    entries = []
    for url in LIST_PAGES:
        print(f"Fetching list page: {url}")
        page_html = fetch_page(url)
        for slug, raw_name in LIST_LINK_RE.findall(page_html):
            if any(slug.startswith(p) for p in SKIP_SLUG_PREFIXES):
                continue
            if slug in seen_slugs:
                continue
            seen_slugs.add(slug)
            name = html.unescape(raw_name).strip()
            entries.append(PokemonEntry(slug, name))
        jittered_delay(base_delay)
    print(f"Discovered {len(entries)} unique pokemon across all list pages.")
    return entries


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def get_existing_pokemon(db_path):
    """Return ``(existing_names_lower_set, existing_name_map, favorites_lower_set)``."""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cur = conn.execute("SELECT name FROM pokemon")
        rows = cur.fetchall()
        names_lower = {r[0].lower() for r in rows}
        name_map = {r[0].lower(): r[0] for r in rows}

        cur = conn.execute("SELECT name FROM favorites")
        fav_lower = {r[0].lower() for r in cur.fetchall()}
    finally:
        conn.close()
    return names_lower, name_map, fav_lower


# ---------------------------------------------------------------------------
# Phase 2: Detail-page scraper
# ---------------------------------------------------------------------------

# Two-step image extraction: find the <img> tag with id="sprite-regular", then
# pull out the src attribute. Handles either attribute order and XHTML/HTML tags.
IMG_TAG_RE = re.compile(r'<img[^>]*id="sprite-regular"[^>]*>', re.IGNORECASE)
SRC_RE = re.compile(r'src="([^"]+)"', re.IGNORECASE)

HABITAT_RE = re.compile(
    r'idealhabitat/([a-z]+)\.shtml"><u>([A-Za-z]+)</u>', re.IGNORECASE
)

FAVORITE_RE = re.compile(
    r'href="/pokemonpokopia/favorites/([^"]+)\.shtml"><u>([^<]+)</u></a>'
)


def scrape_pokemon_detail(slug, base_delay):
    """Fetch ``slug``'s detail page and extract image/habitat/favorites.

    Returns a ``PokemonDetail`` namedtuple, or ``None`` on extraction failure.
    """
    url = DETAIL_URL_TMPL.format(slug)
    page_html = fetch_page(url)

    # --- Image URL ---
    image_url = None
    img_tag_match = IMG_TAG_RE.search(page_html)
    if img_tag_match:
        src_match = SRC_RE.search(img_tag_match.group(0))
        if src_match:
            image_url = src_match.group(1)

    # --- Habitat ---
    habitat = None
    hab_match = HABITAT_RE.search(page_html)
    if hab_match:
        habitat = hab_match.group(2)  # the display text, e.g. "Bright"

    # --- Favorites ---
    favorites = []
    for _fav_slug, fav_name in FAVORITE_RE.findall(page_html):
        favorites.append(html.unescape(fav_name).strip())

    # --- Name (re-derive from slug is unreliable; use the display text on the
    # page). We'll pass the name from the list page instead, so set it here to
    # None — the caller fills it in. ---
    image_filename = None
    if image_url:
        image_filename = image_url.rsplit("/", 1)[-1]

    if image_url is None or habitat is None:
        print(
            f"  WARNING: incomplete extraction for '{slug}': "
            f"image_url={image_url}, habitat={habitat}, favorites={favorites}"
        )
        return None

    detail = PokemonDetail(
        slug=slug,
        name=slug,  # placeholder; caller overwrites with list-page name
        image_url=image_url,
        image_filename=image_filename,
        habitat=habitat,
        favorites=favorites,
    )
    jittered_delay(base_delay)
    return detail


# ---------------------------------------------------------------------------
# Phase 3: Comparison
# ---------------------------------------------------------------------------


def find_missing_pokemon(all_entries, existing_names_lower):
    """Return list of entries not present in the DB (case-insensitive)."""
    missing = []
    for entry in all_entries:
        if entry.name.lower() not in existing_names_lower:
            missing.append(entry)
    return missing


# ---------------------------------------------------------------------------
# Phase 4: Image download + DB insertion
# ---------------------------------------------------------------------------


def download_image(image_url, dest_filename, images_dir, db_path, base_delay):
    """Download the sprite to ``images_dir/dest_filename``.

    Collision check: if the file already exists and a DB pokemon references it,
    skip (already present). If the file exists but no pokemon references it,
    overwrite (stale file from a prior partial run).

    Returns the DB-bound image_path value ``images/<dest_filename>``.
    """
    dest_path = os.path.join(images_dir, dest_filename)
    db_image_path = f"images/{dest_filename}"

    if os.path.exists(dest_path):
        # Check if any pokemon in the DB uses this image_path.
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            cur = conn.execute(
                "SELECT COUNT(*) FROM pokemon WHERE image_path = ?", (db_image_path,)
            )
            count = cur.fetchone()[0]
        finally:
            conn.close()
        if count > 0:
            print(f"    Image already present and referenced: {db_image_path} (skip)")
            return db_image_path
        else:
            print(f"    Stale file exists, overwriting: {dest_path}")

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


def add_pokemon_to_db(db_path, name, image_path, habitat, favorites, existing_fav_lower):
    """Insert a pokemon record + its favorites into the DB.

    ``existing_fav_lower`` is the set of lowercased favorite names in the DB
    (used to flag unmapped favorites rather than auto-inserting them).

    Returns ``(pokemon_id, unmapped_favorites)`` where ``unmapped_favorites``
    is the set of favorite display names that had no DB match.
    """
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys=ON")
    unmapped = set()
    try:
        # --- Habitat validation ---
        cur = conn.execute("SELECT habitat FROM habitats")
        valid_habitats_lower = {r[0].lower(): r[0] for r in cur.fetchall()}

        habitat_db = habitat
        if habitat and habitat.lower() in valid_habitats_lower:
            habitat_db = valid_habitats_lower[habitat.lower()]
        else:
            print(f"    WARNING: habitat '{habitat}' not in habitats table; "
                  f"inserting NULL")
            habitat_db = None

        # --- Insert pokemon ---
        cur = conn.execute(
            "INSERT INTO pokemon (id, name, image_path, habitat) VALUES (NULL, ?, ?, ?)",
            (name, image_path, habitat_db),
        )
        pokemon_id = cur.lastrowid

        # --- Insert favorites ---
        for fav in favorites:
            fav_lower = fav.lower()
            if fav_lower not in existing_fav_lower:
                unmapped.add(fav)
                print(f"    WARNING: favorite '{fav}' not in favorites table; "
                      f"skipping pokemon_favorites entry")
                continue
            conn.execute(
                "INSERT OR IGNORE INTO pokemon_favorites (pokemon_id, favorite_name) "
                "VALUES (?, ?)",
                (pokemon_id, fav_lower),
            )
        conn.commit()
    finally:
        conn.close()
    return pokemon_id, unmapped


# ---------------------------------------------------------------------------
# Phase 5: Verification
# ---------------------------------------------------------------------------


def verify_completeness(db_path, all_entries, images_dir):
    """Check DB pokemon set vs. Serebii list + run data-integrity assertions.

    Returns ``True`` if complete and no integrity violations.
    """
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cur = conn.execute("SELECT name FROM pokemon")
        db_names_lower = {r[0].lower() for r in cur.fetchall()}

        cur = conn.execute("SELECT habitat FROM habitats")
        valid_habitats = {r[0] for r in cur.fetchall()}

        cur = conn.execute("SELECT name FROM favorites")
        valid_favorites = {r[0] for r in cur.fetchall()}

        # All pokemon (with image_path) for file-existence check.
        cur = conn.execute("SELECT name, image_path, habitat FROM pokemon")
        all_pokemon = cur.fetchall()

        # pokemon_favorites integrity
        cur = conn.execute(
            "SELECT pf.pokemon_id, pf.favorite_name FROM pokemon_favorites pf"
        )
        pf_rows = cur.fetchall()

        # All pokemon ids for FK check
        cur = conn.execute("SELECT id FROM pokemon")
        valid_pokemon_ids = {r[0] for r in cur.fetchall()}
    finally:
        conn.close()

    serebii_names_lower = {e.name.lower() for e in all_entries}
    missing = serebii_names_lower - db_names_lower
    extra = db_names_lower - serebii_names_lower

    print("\n" + "=" * 60)
    print("VERIFICATION REPORT")
    print("=" * 60)
    print(f"Serebii unique pokemon: {len(serebii_names_lower)}")
    print(f"DB pokemon count:      {len(db_names_lower)}")
    if missing:
        print(f"MISSING from DB ({len(missing)}):")
        for name in sorted(missing):
            print(f"  - {name}")
    else:
        print("Missing from DB: none")
    if extra:
        print(f"Extra in DB (not on Serebii, {len(extra)}):")
        for name in sorted(extra):
            print(f"  + {name}")

    # --- Integrity assertions ---
    violations = []

    # 1. Every pokemon has non-null image_path
    for name, image_path, habitat in all_pokemon:
        if image_path is None or image_path == "":
            violations.append(f"pokemon '{name}' has null/empty image_path")

    # 2. Every pokemon has a valid habitat (or NULL is acceptable per schema,
    #    but newly harvested ones should have one — flag only if non-null and
    #    not in valid set).
    for name, image_path, habitat in all_pokemon:
        if habitat is not None and habitat not in valid_habitats:
            violations.append(
                f"pokemon '{name}' has invalid habitat '{habitat}'"
            )

    # 3. Every pokemon_favorites entry has a valid pokemon_id and favorite_name
    for pid, fav_name in pf_rows:
        if pid not in valid_pokemon_ids:
            violations.append(
                f"pokemon_favorites orphan: pokemon_id={pid} not in pokemon table"
            )
        if fav_name not in valid_favorites:
            violations.append(
                f"pokemon_favorites orphan (pokemon_id={pid}): favorite_name "
                f"'{fav_name}' not in favorites table"
            )

    # 4. Every image_path file exists on disk
    for name, image_path, habitat in all_pokemon:
        if image_path:
            local_file = os.path.join(images_dir, image_path.replace("images/", ""))
            if not os.path.exists(local_file):
                violations.append(
                    f"pokemon '{name}': image file missing on disk: {local_file}"
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
# Unmapped favorites reporting
# ---------------------------------------------------------------------------


def flag_unmapped_favorites(all_seen_favorites, db_favorites_lower):
    """Report Serebii favorites that have no DB match (case-insensitive)."""
    unmapped = set()
    for fav in all_seen_favorites:
        if fav.lower() not in db_favorites_lower:
            unmapped.add(fav)

    print("\n--- Unmapped Favorites ---")
    if unmapped:
        print(f"{len(unmapped)} Serebii favorite(s) have no match in DB:")
        for fav in sorted(unmapped):
            print(f"  - {fav}")
    else:
        print("All Serebii favorites matched existing DB favorites.")
    return unmapped


# ---------------------------------------------------------------------------
# Main / CLI
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Harvest missing Pokemon from Serebii's Pokopia Pokedex."
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
    args = parser.parse_args()

    db_path = os.path.abspath(args.db)
    images_dir = os.path.abspath(args.images_dir)
    base_delay = args.delay

    # --- Verify-only mode ---
    if args.verify:
        print("Running in verify-only mode.\n")
        # We still need the Serebii list to compare against.
        all_entries = scrape_pokemon_list(base_delay)
        verify_completeness(db_path, all_entries, images_dir)
        return

    # --- Harvest mode (dry-run or real) ---
    print("Fetching Serebii pokemon lists...")
    all_entries = scrape_pokemon_list(base_delay)

    existing_names_lower, existing_name_map, existing_fav_lower = get_existing_pokemon(
        db_path
    )

    missing = find_missing_pokemon(all_entries, existing_names_lower)
    existing_count = len(all_entries) - len(missing)

    print(
        f"\nFound {len(all_entries)} pokemon on Serebii, "
        f"{existing_count} already in DB, {len(missing)} to add."
    )

    if not missing:
        print("Nothing to add. Running verification...")
        verify_completeness(db_path, all_entries, images_dir)
        return

    # --- Dry run ---
    if args.dry_run:
        print(f"\n[DRY RUN] Would add {len(missing)} pokemon:\n")
        for i, entry in enumerate(missing, 1):
            try:
                detail = scrape_pokemon_detail(entry.slug, base_delay)
            except Exception as e:
                print(f"  [{i}/{len(missing)}] ERROR scraping '{entry.name}': {e}")
                continue
            if detail is None:
                print(
                    f"  [{i}/{len(missing)}] DRY RUN: would add {entry.name} "
                    f"(EXTRACTION FAILED — see warnings above)"
                )
                continue
            print(
                f"  [{i}/{len(missing)}] DRY RUN: would add {entry.name} "
                f"(habitat={detail.habitat}, image={detail.image_url}, "
                f"favorites={detail.favorites})"
            )
        print("\n[DRY RUN complete — no writes performed.]")
        return

    # --- Real harvest ---
    os.makedirs(images_dir, exist_ok=True)
    all_seen_favorites = set()
    added = 0
    failed = 0

    print(f"\nHarvesting {len(missing)} pokemon...\n")
    for i, entry in enumerate(missing, 1):
        try:
            detail = scrape_pokemon_detail(entry.slug, base_delay)
            if detail is None:
                print(f"  [{i}/{len(missing)}] SKIP '{entry.name}': extraction failed")
                failed += 1
                continue

            # Track all favorites seen (for unmapped report).
            all_seen_favorites.update(detail.favorites)

            # Download image.
            image_path = download_image(
                detail.image_url,
                detail.image_filename,
                images_dir,
                db_path,
                base_delay,
            )

            # Insert into DB.
            pokemon_id, unmapped = add_pokemon_to_db(
                db_path,
                entry.name,
                image_path,
                detail.habitat,
                detail.favorites,
                existing_fav_lower,
            )

            print(
                f"  [{i}/{len(missing)}] Added {entry.name} "
                f"(habitat={detail.habitat}, favorites={detail.favorites})"
            )
            added += 1
        except Exception as e:
            print(f"  [{i}/{len(missing)}] ERROR adding '{entry.name}': {e}")
            failed += 1
            continue

    # --- Unmapped favorites report ---
    # Include favorites from DB-wide scan + all seen during this run.
    flag_unmapped_favorites(all_seen_favorites, existing_fav_lower)

    # --- Verification ---
    print(f"\nHarvest complete: added={added}, failed={failed}, total on Serebii={len(all_entries)}")
    verify_completeness(db_path, all_entries, images_dir)


if __name__ == "__main__":
    main()
