CREATE TABLE
    favorites (name TEXT PRIMARY KEY);

CREATE TABLE
    pokemon (
        id INTEGER PRIMARY KEY
      , name TEXT UNIQUE NOT NULL
      , image_path TEXT
      , habitat TEXT REFERENCES habitats (habitat)
    );

CREATE TABLE
    pokemon_favorites (
        pokemon_id INTEGER NOT NULL REFERENCES pokemon (id)
      , favorite_name TEXT NOT NULL REFERENCES favorites (name)
      , PRIMARY KEY (pokemon_id, favorite_name)
    );

CREATE TABLE
    items (
        id INTEGER PRIMARY KEY
      , name TEXT UNIQUE NOT NULL
      , category TEXT
      , picture_path TEXT
      , flavor_text TEXT
      , tag TEXT
    );

CREATE TABLE
    item_favorites (
        item_id INTEGER NOT NULL REFERENCES items (id)
      , favorite_name TEXT NOT NULL REFERENCES favorites (name)
      , PRIMARY KEY (item_id, favorite_name)
    );

CREATE TABLE
    item_recipe (
        item_id INTEGER NOT NULL REFERENCES items (id)
      , ingredient_id INTEGER NOT NULL REFERENCES items (id)
      , COUNT INTEGER NOT NULL
      , PRIMARY KEY (item_id, ingredient_id)
    );

CREATE TABLE
    habitats (
        habitat TEXT PRIMARY KEY
      , opposite TEXT NOT NULL REFERENCES habitats (habitat) DEFERRABLE INITIALLY DEFERRED
    );

CREATE VIEW
    shared_favorites AS
SELECT
    pfl.pokemon_id AS pokemon_a
  , pfr.pokemon_id AS pokemon_b
FROM
    pokemon_favorites pfl
    INNER JOIN pokemon_favorites pfr ON (pfl.favorite_name = pfl.favorite_name)
    LEFT JOIN pokemon pl ON (pfl.pokemon_id = pl.id)
    LEFT JOIN pokemon pr ON (pfr.pokemon_id = pr.id)
    LEFT JOIN habitats h ON (pl.habitat = h.habitat)
WHERE
    pfl.pokemon_id != pfr.pokemon_id
    AND pfl.favorite_name = pfr.favorite_name
    AND pr.habitat != h.opposite
    /* shared_favorites(pokemon_a,pokemon_b) */;

CREATE VIEW
    shared_habitat AS
SELECT
    pl.id AS pokemon_a
  , pr.id AS pokemon_b
FROM
    pokemon pl
    LEFT JOIN pokemon pr ON (pl.habitat = pr.habitat)
WHERE
    pl.id != pr.id
    /* shared_habitat(pokemon_a,pokemon_b) */;

CREATE VIEW
    adjacency AS
WITH
    combined_adjacency AS (
        SELECT
            pokemon_a
          , pokemon_b
        FROM
            shared_favorites
        UNION ALL
        SELECT
            pokemon_a
          , pokemon_b
        FROM
            shared_habitat
    )
SELECT
    pokemon_a
  , pokemon_b
  , COUNT(1) AS score
FROM
    combined_adjacency
GROUP BY
    pokemon_a
  , pokemon_b
    /* adjacency(pokemon_a,pokemon_b,score) */;