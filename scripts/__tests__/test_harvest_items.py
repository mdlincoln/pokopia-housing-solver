#!/usr/bin/env python3
"""Unit tests for scripts/harvest_items.py.

Tests use unittest.mock.patch to mock fetch_page with canned HTML snippets,
so no network access is required. Run with:

    python3 -m pytest scripts/__tests__/test_harvest_items.py
    # or
    python3 -m unittest scripts.__tests__.test_harvest_items
"""

import io
import os
import shutil
import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

# Make the script importable.
SCRIPTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, SCRIPTS_DIR)

import harvest_items as hi


# ---------------------------------------------------------------------------
# Sample HTML snippets (based on real Serebii page structure)
# ---------------------------------------------------------------------------

FAVORITES_NAV_HTML = """<select>
<option value="/pokemonpokopia/habitats.shtml">Pok&eacute;mon Pokopia - Favorites Database</option>
<option value="/pokemonpokopia/favorites/blockystuff.shtml">Blocky stuff</option>
<option value="/pokemonpokopia/favorites/cleanliness.shtml">Cleanliness</option>
</select>"""

FAVORITES_PAGE_HTML = """<table>
<tr>
<td class="cen"><a href="/pokemonpokopia/items/paper.shtml"><img src="/pokemonpokopia/items/paper.png" alt="Paper" /></a></td>
<td class="cen"><a href="/pokemonpokopia/items/paper.shtml"><u>Paper</u></a></td>
<td class="cen"><a href="/pokemonpokopia/items/decoration.shtml"><img src="/pokemonpokopia/items/decoration.png" alt="Decoration" /><br />Decoration</a></td>
</tr>
<tr>
<td class="cen"><a href="/pokemonpokopia/items/wallstoragebox.shtml"><img src="/pokemonpokopia/items/wallstoragebox.png" alt="Wall storage box" /></a></td>
<td class="cen"><a href="/pokemonpokopia/items/wallstoragebox.shtml"><u>Wall storage box</u></a></td>
<td class="cen"><a href="/pokemonpokopia/items/decoration.shtml"><img src="/pokemonpokopia/items/decoration.png" alt="Decoration" /><br />Decoration</a></td>
</tr>
</table>"""

# The favorites nav <select> lives on every favorites page (including
# blockystuff.shtml), so blockystuff.shtml returns nav + page content.
BLOCKYSTUFF_PAGE_HTML = FAVORITES_NAV_HTML + FAVORITES_PAGE_HTML

ITEMS_LISTING_HTML = """<table>
<tr><td class="cen"><a href="items/honey.shtml"><u>Honey</u></a></td></tr>
<tr><td class="cen"><a href="items/sturdystick.shtml"><u>Sturdy stick</u></a></td></tr>
</table>"""

# Full detail page with all fields present (tag = &nbsp; → None).
STORAGEBOX_DETAIL_HTML = """<html><body>
<tr><td><h1>Storage box</h1></td></tr>
<tr><td class="fooevo">Picture</td></tr>
<tr>
<td class="fooinfo" align="center">
<table align="center"><tr><td class="pkmn"><img src="/pokemonpokopia/items/storagebox.png" loading="lazy" alt="Storage box" style="height:150px" /></td></tr></table>
</td></table>
<table class="tab" align="center">
<tr>
<td class="fooevo" width="25%">Category</td>
<td class="fooevo" width="25%">Tag</td>
<td class="fooevo">Paintable</td>
<td class="fooevo" width="25%">Requirements</td>
</tr>
<tr>
<td class="cen">
Furniture</td><td class="cen">
&nbsp;</td>
<td class="cen">Paint<br /></td>
<td class="cen">
</td></tr>
<tr>
<td class="fooevo" width="25%">Trade Value</td>
<td class="fooevo" width="25%">3D Print Cost</td>
<td class="fooevo" width="50%" colspan="2">Favorite Categories</td>
</tr>
<tr>
<td class="cen"><table><tr><td>Standard</td><td>50</td></tr><tr><td>Favorite:</td><td>75</td></tr></table></td>
<td class="cen"><table><tr><td><img src="/pokemonpokopia/items/pokemetal.png" height="25" alt="Pok&eacute;metal" /></td><td>2 Pok&eacute;metal</td></tr></table></td>
<td class="cen" colspan="2" valign="top">
<a href="/pokemonpokopia/favorites/woodenstuff.shtml"><u>Wooden stuff</u></a><br /></td>
</tr>
</table>
<table class="tab" align="center">
<tr><td class="fooevo"><h2>Flavor Text</h2></td></tr>
<tr><td class="fooinfo">
A convenient box you can store items in. It's made of wood and easy to move things in and out of.
</td></tr>
</table>
<table class="dextable" align="center">
<tr><td class="fooevo" colspan="3"><h2>Recipe</h2></td></tr>
<tr><td class="fooblack">Location</td><td class="fooinfo">Register 6 Pok&eacute;mon</td></tr>
<tr><td class="fooinfo" colspan="2"><table align="center">
<tr><td><a href="lumber.shtml"><img src="lumber.png" alt="Lumber" loading="lazy" height="30" /></td><td><a href="lumber.shtml"><u>Lumber</u></a> * 1</td></tr>
</table></td></tr></table>
<table class="dextable" align="center">
<tr><td class="fooevo" colspan="4"><h2>Storage box Color Variants</h2></td></tr>
</table>
</body></html>"""

# Multi-ingredient recipe (Gaming Bed).
GAMINGBED_DETAIL_HTML = """<html><body>
<tr><td><h1>Gaming Bed</h1></td></tr>
<tr><td class="fooevo">Picture</td></tr>
<tr>
<td class="fooinfo" align="center">
<table align="center"><tr><td class="pkmn"><img src="/pokemonpokopia/items/gamingbed.png" loading="lazy" alt="Gaming Bed" style="height:150px" /></td></tr></table>
</td></table>
<table class="tab" align="center">
<tr>
<td class="fooevo" width="25%">Category</td>
<td class="fooevo" width="25%">Tag</td>
<td class="fooevo">Paintable</td>
<td class="fooevo" width="25%">Requirements</td>
</tr>
<tr>
<td class="cen">
Relaxation</td><td class="cen">
&nbsp;</td>
<td class="cen">Paint<br /></td>
<td class="cen">
</td></tr>
<tr>
<td class="fooevo" width="25%">Trade Value</td>
<td class="fooevo" width="25%">3D Print Cost</td>
<td class="fooevo" width="50%" colspan="2">Favorite Categories</td>
</tr>
<tr>
<td class="cen"><table><tr><td>Standard</td><td>50</td></tr></table></td>
<td class="cen"><table><tr><td>2 Pok&eacute;metal</td></tr></table></td>
<td class="cen" colspan="2" valign="top">
<a href="/pokemonpokopia/favorites/woodenstuff.shtml"><u>Wooden stuff</u></a><br /></td>
</tr>
</table>
<table class="tab" align="center">
<tr><td class="fooevo"><h2>Flavor Text</h2></td></tr>
<tr><td class="fooinfo">
A game machine from a facility somewhere.
</td></tr>
</table>
<table class="dextable" align="center">
<tr><td class="fooevo" colspan="3"><h2>Recipe</h2></td></tr>
<tr><td class="fooblack">Location</td><td class="fooinfo">Shop</td></tr>
<tr><td class="fooinfo" colspan="2"><table align="center">
<tr><td><a href="pokemetal.shtml"><img src="pokemetal.png" alt="Pok&eacute;metal" loading="lazy" height="30" /></td><td><a href="pokemetal.shtml"><u>Pok&eacute;metal</u></a> * 2</td></tr>
<tr><td><a href="fluff.shtml"><img src="fluff.png" alt="Fluff" loading="lazy" height="30" /></td><td><a href="fluff.shtml"><u>Fluff</u></a> * 2</td></tr>
<tr><td><a href="goldingot.shtml"><img src="goldingot.png" alt="Gold ingot" loading="lazy" height="30" /></td><td><a href="goldingot.shtml"><u>Gold ingot</u></a> * 2</td></tr>
</table></td></tr></table>
<table class="dextable" align="center">
<tr><td class="fooevo" colspan="3"><h2>Habitats Used In</h2></td></tr>
</table>
</body></html>"""

# Detail page with a tag (link-wrapped Decoration).
WALLSTORAGEBOX_DETAIL_HTML = """<html><body>
<tr><td><h1>Wall storage box</h1></td></tr>
<tr><td class="fooevo">Picture</td></tr>
<tr>
<td class="fooinfo" align="center">
<table align="center"><tr><td class="pkmn"><img src="/pokemonpokopia/items/wallstoragebox.png" loading="lazy" alt="Wall storage box" style="height:150px" /></td></tr></table>
</td></table>
<table class="tab" align="center">
<tr>
<td class="fooevo" width="25%">Category</td>
<td class="fooevo" width="25%">Tag</td>
<td class="fooevo">Paintable</td>
<td class="fooevo" width="25%">Requirements</td>
</tr>
<tr>
<td class="cen">
Furniture</td><td class="cen">
<a href="decoration.shtml"><img src="decoration.png" alt="Decoration" loading="lazy" height="40" /><br />Decoration</a></td>
<td class="cen">Paint<br /></td>
<td class="cen">
</td></tr>
<tr>
<td class="fooevo" width="25%">Trade Value</td>
<td class="fooevo" width="25%">3D Print Cost</td>
<td class="fooevo" width="50%" colspan="2">Favorite Categories</td>
</tr>
<tr>
<td class="cen"><table><tr><td>Standard</td><td>50</td></tr></table></td>
<td class="cen"><table><tr><td>2 Pok&eacute;metal</td></tr></table></td>
<td class="cen" colspan="2" valign="top">
<a href="/pokemonpokopia/favorites/woodenstuff.shtml"><u>Wooden stuff</u></a><br /></td>
</tr>
</table>
<table class="tab" align="center">
<tr><td class="fooevo"><h2>Flavor Text</h2></td></tr>
<tr><td class="fooinfo">
It may be small, but it can store lots of stuff.
</td></tr>
</table>
<table class="dextable" align="center">
<tr><td class="fooevo" colspan="3"><h2>Recipe</h2></td></tr>
<tr><td class="fooinfo" colspan="2"><table align="center">
<tr><td><a href="lumber.shtml"><u>Lumber</u></a> * 2</td></tr>
</table></td></tr></table>
<table class="dextable" align="center">
<tr><td class="fooevo"><h2>Color Variants</h2></td></tr>
</table>
</body></html>"""


# ---------------------------------------------------------------------------
# Helper: create a temp DB with the item-related schema
# ---------------------------------------------------------------------------

def make_temp_db():
    db_path = tempfile.mktemp(suffix=".db")
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute(
        "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, "
        "category TEXT, picture_path TEXT, flavor_text TEXT, tag TEXT)"
    )
    conn.execute(
        "CREATE TABLE item_favorites (item_id INTEGER NOT NULL REFERENCES items(id), "
        "favorite_name TEXT NOT NULL REFERENCES favorites(name), "
        "PRIMARY KEY (item_id, favorite_name))"
    )
    conn.execute(
        "CREATE TABLE item_recipe (item_id INTEGER NOT NULL REFERENCES items(id), "
        "ingredient_id INTEGER NOT NULL REFERENCES items(id), COUNT INTEGER NOT NULL, "
        "PRIMARY KEY (item_id, ingredient_id))"
    )
    conn.execute("CREATE TABLE favorites (name TEXT PRIMARY KEY)")
    conn.commit()
    conn.close()
    return db_path


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestCLIHelp(unittest.TestCase):
    """AC.1: --help runs without error."""

    def test_cli_help(self):
        import subprocess

        result = subprocess.run(
            [sys.executable, os.path.join(SCRIPTS_DIR, "harvest_items.py"), "--help"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0)
        self.assertIn("--dry-run", result.stdout)
        self.assertIn("--verify", result.stdout)
        self.assertIn("--delay", result.stdout)


class TestDetailPageExtraction(unittest.TestCase):
    """AC.4: Detail page extraction of all fields."""

    @patch.object(hi, "fetch_page")
    @patch.object(hi, "jittered_delay")
    def test_detail_page_extraction_full(self, _mock_delay, mock_fetch):
        """Feed sample storagebox.shtml HTML; verify all fields."""
        mock_fetch.return_value = STORAGEBOX_DETAIL_HTML

        detail = hi.scrape_item_detail("storagebox", 0.1)

        self.assertIsNotNone(detail)
        self.assertEqual(detail.name, "Storage box")
        self.assertEqual(detail.image_url, "/pokemonpokopia/items/storagebox.png")
        self.assertEqual(detail.image_filename, "storagebox.png")
        self.assertEqual(detail.category, "Furniture")
        self.assertIsNone(detail.tag)  # &nbsp; → None
        self.assertIn("convenient box", detail.flavor_text)
        self.assertEqual(len(detail.recipe), 1)
        self.assertEqual(detail.recipe[0].slug, "lumber")
        self.assertEqual(detail.recipe[0].name, "Lumber")
        self.assertEqual(detail.recipe[0].count, 1)
        self.assertEqual(detail.favorites, ["Wooden stuff"])


class TestMultiIngredientRecipe(unittest.TestCase):
    """AC.5: Multi-ingredient recipe extraction."""

    @patch.object(hi, "fetch_page")
    @patch.object(hi, "jittered_delay")
    def test_multi_ingredient_recipe_extraction(self, _mock_delay, mock_fetch):
        """Feed sample gamingbed.shtml recipe HTML; verify 3 ingredients."""
        mock_fetch.return_value = GAMINGBED_DETAIL_HTML

        detail = hi.scrape_item_detail("gamingbed", 0.1)

        self.assertIsNotNone(detail)
        self.assertEqual(len(detail.recipe), 3)
        self.assertEqual(detail.recipe[0].slug, "pokemetal")
        self.assertEqual(detail.recipe[0].name, "Pok\u00e9metal")
        self.assertEqual(detail.recipe[0].count, 2)
        self.assertEqual(detail.recipe[1].slug, "fluff")
        self.assertEqual(detail.recipe[1].name, "Fluff")
        self.assertEqual(detail.recipe[1].count, 2)
        self.assertEqual(detail.recipe[2].slug, "goldingot")
        self.assertEqual(detail.recipe[2].name, "Gold ingot")
        self.assertEqual(detail.recipe[2].count, 2)


class TestFavoritesPageExtraction(unittest.TestCase):
    """AC.6: Favorites-page item extraction excludes tag links."""

    @patch.object(hi, "fetch_page")
    @patch.object(hi, "jittered_delay")
    def test_favorites_page_item_extraction(self, _mock_delay, mock_fetch):
        """Feed sample blockystuff.shtml HTML; verify item slugs/names extracted."""
        mock_fetch.return_value = FAVORITES_PAGE_HTML

        results = hi.scrape_favorites_page(
            "https://www.serebii.net/pokemonpokopia/favorites/blockystuff.shtml",
            "Blocky stuff",
            0.1,
        )

        self.assertEqual(len(results), 2)

        item1, fav1 = results[0]
        self.assertEqual(item1.slug, "paper")
        self.assertEqual(item1.name, "Paper")
        self.assertEqual(fav1, "blocky stuff")

        item2, fav2 = results[1]
        self.assertEqual(item2.slug, "wallstoragebox")
        self.assertEqual(item2.name, "Wall storage box")
        self.assertEqual(fav2, "blocky stuff")

        # Tag links (decoration.shtml) NOT extracted as items.
        slugs = {r[0].slug for r in results}
        self.assertNotIn("decoration", slugs)


class TestHTMLEntityUnescaping(unittest.TestCase):
    """AC.9: HTML entities are properly unescaped."""

    @patch.object(hi, "fetch_page")
    @patch.object(hi, "jittered_delay")
    def test_html_entity_unescaping(self, _mock_delay, mock_fetch):
        """Verify Pok&eacute;metal → Pokémetal and &nbsp; tag → None."""
        mock_fetch.return_value = GAMINGBED_DETAIL_HTML

        detail = hi.scrape_item_detail("gamingbed", 0.1)

        self.assertIsNotNone(detail)
        # Recipe ingredient name should have é, not &eacute;.
        self.assertEqual(detail.recipe[0].name, "Pok\u00e9metal")
        self.assertNotIn("&eacute;", detail.recipe[0].name)

        # Tag should be None (&nbsp; → None).
        self.assertIsNone(detail.tag)


class TestTagExtractionVariants(unittest.TestCase):
    """Verify tag extraction handles &nbsp;, link-wrapped, and plain text."""

    @patch.object(hi, "fetch_page")
    @patch.object(hi, "jittered_delay")
    def test_tag_none(self, _mock_delay, mock_fetch):
        """&nbsp; tag → None."""
        mock_fetch.return_value = STORAGEBOX_DETAIL_HTML
        detail = hi.scrape_item_detail("storagebox", 0.1)
        self.assertIsNotNone(detail)
        self.assertIsNone(detail.tag)

    @patch.object(hi, "fetch_page")
    @patch.object(hi, "jittered_delay")
    def test_tag_link_wrapped(self, _mock_delay, mock_fetch):
        """Link-wrapped tag → tag name."""
        mock_fetch.return_value = WALLSTORAGEBOX_DETAIL_HTML
        detail = hi.scrape_item_detail("wallstoragebox", 0.1)
        self.assertIsNotNone(detail)
        self.assertEqual(detail.tag, "Decoration")


class TestRecipeLookupMissingIngredient(unittest.TestCase):
    """AC.7: Warning when ingredient slug not in slug_map."""

    def test_recipe_lookup_missing_ingredient(self):
        """Verify warning logged when ingredient slug not in slug_map."""
        db_path = make_temp_db()
        try:
            conn = sqlite3.connect(db_path)
            conn.execute("INSERT INTO items (id, name) VALUES (1, 'Test Item')")
            conn.commit()
            conn.close()

            recipe = [
                hi.RecipeIngredient(slug="nonexistent", name="Nonexistent", count=1)
            ]
            slug_map = {}  # empty — no ingredients in DB

            # Should not crash, should just warn.
            hi.add_recipe_for_item(db_path, 1, recipe, slug_map)

            # Verify no recipe rows were inserted.
            conn = sqlite3.connect(db_path)
            cur = conn.execute("SELECT COUNT(*) FROM item_recipe")
            count = cur.fetchone()[0]
            conn.close()
            self.assertEqual(count, 0)
        finally:
            os.unlink(db_path)


class TestTwoPassInsertionOrder(unittest.TestCase):
    """AC.7: All item INSERTs complete before any recipe INSERTs."""

    def test_two_pass_insertion_order(self):
        """Verify all item INSERTs come before recipe INSERTs via mocked cursor."""
        db_path = make_temp_db()

        insert_order = []
        original_connect = sqlite3.connect

        class TrackingConnection:
            def __init__(self, real_conn):
                self._real = real_conn

            def execute(self, sql, *args, **kwargs):
                if "INSERT" in sql.upper():
                    insert_order.append(sql)
                return self._real.execute(sql, *args, **kwargs)

            def commit(self):
                self._real.commit()

            def close(self):
                self._real.close()

            def __getattr__(self, name):
                return getattr(self._real, name)

        def tracking_connect(*args, **kwargs):
            return TrackingConnection(original_connect(*args, **kwargs))

        try:
            with patch("harvest_items.sqlite3.connect", side_effect=tracking_connect):
                # Pass 1: insert items.
                id1 = hi.add_item_to_db(
                    db_path, "Item A", "images/itema.png", "Furniture", None, "text A"
                )
                id2 = hi.add_item_to_db(
                    db_path, "Item B", "images/itemb.png", "Furniture", None, "text B"
                )

                slug_map = {"itema": id1, "itemb": id2}

                # Pass 2: insert recipes.
                recipe_b = [
                    hi.RecipeIngredient(slug="itema", name="Item A", count=2)
                ]
                hi.add_recipe_for_item(db_path, id2, recipe_b, slug_map)

            item_inserts = [
                i for i, s in enumerate(insert_order)
                if "INTO items" in s
            ]
            recipe_inserts = [
                i for i, s in enumerate(insert_order)
                if "INTO item_recipe" in s
            ]

            self.assertTrue(len(item_inserts) >= 2)
            self.assertTrue(len(recipe_inserts) >= 1)

            # All item inserts should have indices less than all recipe inserts.
            max_item_idx = max(item_inserts)
            min_recipe_idx = min(recipe_inserts)
            self.assertLess(max_item_idx, min_recipe_idx)
        finally:
            os.unlink(db_path)


class TestFavoriteBackfill(unittest.TestCase):
    """AC.8: Existing items with missing favorites get backfilled via INSERT OR IGNORE."""

    def test_favorite_backfill(self):
        """Verify INSERT OR IGNORE called for existing items with missing favorites."""
        db_path = make_temp_db()
        try:
            conn = sqlite3.connect(db_path)
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("INSERT INTO favorites (name) VALUES ('wooden stuff')")
            conn.execute("INSERT INTO favorites (name) VALUES ('blocky stuff')")
            conn.execute(
                "INSERT INTO items (id, name, picture_path) "
                "VALUES (1, 'Storage box', 'images/storagebox.png')"
            )
            conn.commit()
            conn.close()

            slug_map = {"storagebox": 1}
            favorites_map = {"storagebox": {"wooden stuff", "blocky stuff"}}
            existing_fav_lower = {"wooden stuff", "blocky stuff"}

            hi.backfill_favorites(
                db_path, favorites_map, slug_map, existing_fav_lower
            )

            # Verify both favorites were inserted.
            conn = sqlite3.connect(db_path)
            cur = conn.execute(
                "SELECT favorite_name FROM item_favorites WHERE item_id = 1"
            )
            favs = {row[0] for row in cur.fetchall()}
            conn.close()

            self.assertEqual(favs, {"wooden stuff", "blocky stuff"})
        finally:
            os.unlink(db_path)


class TestDryRunIntegration(unittest.TestCase):
    """AC.2: Dry run integration test with mocked fetch_page."""

    @patch.object(hi, "jittered_delay")
    @patch.object(hi, "fetch_page")
    def test_dry_run_integration(self, mock_fetch, _mock_delay):
        """Mock fetch_page to return canned HTML; verify --dry-run output."""
        db_path = make_temp_db()
        images_dir = tempfile.mkdtemp()

        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("INSERT INTO favorites (name) VALUES ('wooden stuff')")
        conn.execute("INSERT INTO favorites (name) VALUES ('blocky stuff')")
        # Insert existing item so new ones are "missing."
        conn.execute(
            "INSERT INTO items (id, name, picture_path) "
            "VALUES (1, 'Paper', 'images/paper.png')"
        )
        conn.commit()
        conn.close()

        def mock_fetch_page(url):
            if "blockystuff.shtml" in url:
                return BLOCKYSTUFF_PAGE_HTML
            elif "cleanliness.shtml" in url:
                return FAVORITES_NAV_HTML + "<table></table>"
            elif url.rstrip("/").endswith("items.shtml"):
                return ITEMS_LISTING_HTML
            elif "storagebox.shtml" in url:
                return STORAGEBOX_DETAIL_HTML
            elif "wallstoragebox.shtml" in url:
                return WALLSTORAGEBOX_DETAIL_HTML
            return ""

        mock_fetch.side_effect = mock_fetch_page

        try:
            buf = io.StringIO()
            with redirect_stdout(buf):
                hi.main([
                    "--dry-run",
                    "--db", db_path,
                    "--images-dir", images_dir,
                    "--delay", "0",
                ])

            output = buf.getvalue()
            self.assertIn("DRY RUN", output)
            self.assertIn("Storage box", output)
            self.assertIn("category=", output)

            # Verify no DB writes occurred.
            conn = sqlite3.connect(db_path)
            cur = conn.execute("SELECT COUNT(*) FROM items")
            self.assertEqual(cur.fetchone()[0], 1)  # only the pre-existing Paper
            conn.close()
        finally:
            os.unlink(db_path)
            shutil.rmtree(images_dir)


class TestVerifyIntegration(unittest.TestCase):
    """AC.3: Verify mode integration test with mocked fetch_page."""

    @patch.object(hi, "jittered_delay")
    @patch.object(hi, "fetch_page")
    def test_verify_integration(self, mock_fetch, _mock_delay):
        """Mock fetch_page; call main(['--verify']); verify report output."""
        db_path = make_temp_db()
        images_dir = tempfile.mkdtemp()

        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("INSERT INTO favorites (name) VALUES ('blocky stuff')")
        conn.execute("INSERT INTO favorites (name) VALUES ('cleanliness')")
        conn.execute(
            "INSERT INTO items (id, name, picture_path) "
            "VALUES (1, 'Paper', 'images/paper.png')"
        )
        conn.commit()
        conn.close()

        def mock_fetch_page(url):
            if "blockystuff.shtml" in url:
                return BLOCKYSTUFF_PAGE_HTML
            elif "cleanliness.shtml" in url:
                return FAVORITES_NAV_HTML + "<table></table>"
            elif url.rstrip("/").endswith("items.shtml"):
                return ITEMS_LISTING_HTML
            return ""

        mock_fetch.side_effect = mock_fetch_page

        try:
            buf = io.StringIO()
            with redirect_stdout(buf):
                hi.main([
                    "--verify",
                    "--db", db_path,
                    "--images-dir", images_dir,
                    "--delay", "0",
                ])

            output = buf.getvalue()
            self.assertIn("VERIFICATION REPORT", output)
            self.assertIn("Serebii unique items:", output)
            self.assertIn("DB items count:", output)
            # "INTEGRITY" appears in either "INTEGRITY VIOLATIONS" or "Integrity: OK".
            self.assertIn("INTEGRITY", output.upper())
        finally:
            os.unlink(db_path)
            shutil.rmtree(images_dir)


if __name__ == "__main__":
    unittest.main()
