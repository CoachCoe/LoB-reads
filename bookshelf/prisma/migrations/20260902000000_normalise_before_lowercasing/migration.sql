-- Normalise before lowercasing, not after.
--
-- DEAD-5. title_norm and author_names_norm were computed as unaccent(lower(x)).
-- This database runs lc_collate=C, under which lower() folds only ASCII: it
-- leaves 'É' alone, and unaccent then yields a capital 'E'.
--
--   lower('Émile Zola')            -> 'Émile zola'
--   unaccent(lower('Émile Zola'))  -> 'Emile zola'   <- what was stored
--   lower(unaccent('Émile Zola'))  -> 'emile zola'   <- correct
--
-- Both sides used the same wrong order, so a query in the same casing still
-- matched and the accented-title test passed. They diverge as soon as the casing
-- differs, which is the normal way to type a title. Measured on the real catalog
-- before this migration:
--
--   title_norm for "Öffentliche Steuerung…" was stored as "Offentliche steuerung…"
--   query "Öffentliche Steuerung und Gest"  ->  trigram 1, prefix 1
--   query "öffentliche steuerung und gest"  ->  trigram 1, prefix 0
--
-- The trigram fallback still finds the work, so nothing looks broken. What is
-- lost is the W_PREFIX +20 ranking bonus on the prefix path, so a reader typing
-- an accented title in lowercase gets the right book ranked as though it were
-- not a prefix match — exactly what the ranking weights exist to prevent.
--
-- Found while fixing DEAD-4: catalog.authors.name_norm was written with the
-- correct order and its trigger test failed against the old one.

-- The body is carried forward from 20260820140000_search_vector_without_subjects,
-- with only the two _norm lines changed. Getting this wrong is easy and was:
-- the first draft copied the body from 20260817160000 instead, which still had
-- subjects in the vector at weight D — silently reverting the fix that stopped
-- "Fiction" matching 735,956 works. Two integration tests caught it. If this
-- function is ever replaced again, diff it against the most recent definition
-- rather than the one that reads most conveniently.
CREATE OR REPLACE FUNCTION "catalog"."works_search_vector_update"()
RETURNS trigger AS $$
BEGIN
  -- Title A, author B, subtitle C. Subjects are deliberately absent.
  NEW.search_vector :=
      setweight(to_tsvector('english', unaccent(coalesce(NEW.title, ''))), 'A')
   || setweight(to_tsvector('english', unaccent(coalesce(NEW.author_names, ''))), 'B')
   || setweight(to_tsvector('english', unaccent(coalesce(NEW.subtitle, ''))), 'C');

  -- The order is the fix. search_vector above is unaffected either way:
  -- to_tsvector folds case through the dictionary rather than through lower().
  NEW.title_norm        := lower(unaccent(coalesce(NEW.title, '')));
  NEW.author_names_norm := lower(unaccent(coalesce(NEW.author_names, '')));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Rewrite only the rows that actually differ.
--
-- Both orders agree for any purely ASCII title, which is the overwhelming
-- majority: measured on the real catalog, 82,756 of 6,943,467 rows differ —
-- 1.19%. Guarding on that turns what would have been a 6.9M-row rewrite of a
-- 13 GB table, with the bloat and the two GIN indexes that implies, into an
-- 83k-row update. The columns are set directly rather than by touching `title`
-- to fire the trigger, so this is one pass and does not recompute search_vector
-- for rows whose vector has not changed.
UPDATE "catalog"."works"
   SET "title_norm"        = lower(unaccent(coalesce("title", ''))),
       "author_names_norm" = lower(unaccent(coalesce("author_names", '')))
 WHERE "title_norm"        IS DISTINCT FROM lower(unaccent(coalesce("title", '')))
    OR "author_names_norm" IS DISTINCT FROM lower(unaccent(coalesce("author_names", '')));
