-- Stage 3 — normalize.
--
-- Projects the staged jsonb into typed columns. Pure SQL, one transaction per
-- table, idempotent: re-running replaces the catalog from whatever is staged.
--
--   psql "$DIRECT_URL" -f scripts/ingest/03-normalize.sql
--
-- Open Library's JSON is inconsistent in specific, documented ways, and each
-- is handled explicitly below rather than assumed away.

BEGIN;

-- Memory for this transaction only.
--
-- The server defaults are tuned for many small concurrent queries: work_mem
-- 4MB, maintenance_work_mem 64MB. This transaction is the opposite workload —
-- a handful of set-based passes over tens of millions of rows, with GROUP BY
-- and DISTINCT ON over the whole edition table. At 4MB those sorts spill to
-- disk almost immediately and the normalize step becomes IO-bound on temp
-- files rather than on the work.
--
-- SET LOCAL, so it reverts at COMMIT and never touches the application's
-- connections. Sized for a machine with room to spare; lower it if the ingest
-- host is small, since work_mem is per sort node and parallel workers each
-- get their own.
SET LOCAL work_mem = '256MB';
SET LOCAL maintenance_work_mem = '2GB';

-- Record the plan of anything that runs for more than a minute.
--
-- Diagnosing a slow statement inside this transaction is otherwise close to
-- impossible: it cannot be EXPLAINed from another session, and every table it
-- touches is locked, so even reading a row count blocks. The first full run
-- lost hours to a bad plan that could only be guessed at from wait events.
--
-- LOAD is per-session and the settings are SET LOCAL, so nothing here affects
-- the server or the application.
LOAD 'auto_explain';
SET LOCAL auto_explain.log_min_duration = '60s';
SET LOCAL auto_explain.log_analyze = on;
SET LOCAL auto_explain.log_buffers = on;
SET LOCAL auto_explain.log_nested_statements = on;

-- Helper functions (clean_isbn, isbn10_to_13, is_valid_isbn13, text_value,
-- publish_year, jsonb_bigint) are defined in migrations, not here.
--
-- jsonb_bigint exists because Open Library emits JSON null inside the covers
-- and photos arrays. A JSON null is not a SQL NULL: casting it to text gives
-- the string 'null', and 'null'::bigint raises. Since this file is a single
-- transaction over ~100 million rows, 933 such editions would abort the entire
-- run after tens of minutes and report a type rather than a record.

-- ---------------------------------------------------------------------------
-- Authors
-- ---------------------------------------------------------------------------
-- Build beside the live catalog, not through it.
--
-- This used to TRUNCATE and rebuild in place. TRUNCATE takes ACCESS EXCLUSIVE
-- and holds it until COMMIT, so for the whole run — nine hours on the first
-- full ingest — every read of these tables blocked. Not an error the app can
-- degrade around: search, work pages and shelf hydration simply hung. The spec
-- calls for a monthly rebuild, which made that a monthly multi-hour outage.
--
-- The rows go into parallel tables and are swapped in at the end, so the lock
-- is held for the length of a rename rather than the length of a rebuild.
-- Readers see the old catalog throughout and the new one immediately after.
--
-- Leftovers from a failed run are dropped rather than reused: a half-built
-- table is worse than no table, and this is cheap.
DROP TABLE IF EXISTS
  catalog.external_ids_new, catalog.editions_new, catalog.work_authors_new,
  catalog.works_new, catalog.authors_new CASCADE;

-- INCLUDING ALL brings the indexes, defaults and check constraints. It does
-- not bring triggers or foreign keys — both are added below — and it names the
-- indexes after the new table, which the swap fixes.
CREATE TABLE catalog.authors_new      (LIKE catalog.authors      INCLUDING ALL);
CREATE TABLE catalog.works_new        (LIKE catalog.works        INCLUDING ALL);
CREATE TABLE catalog.work_authors_new (LIKE catalog.work_authors INCLUDING ALL);
CREATE TABLE catalog.editions_new     (LIKE catalog.editions     INCLUDING ALL);
CREATE TABLE catalog.external_ids_new (LIKE catalog.external_ids INCLUDING ALL);

INSERT INTO catalog.authors_new (ol_key, name, personal_name, birth_date, death_date, bio, photo_id)
SELECT
  s.ol_key,
  coalesce(s.data ->> 'name', '(unknown)'),
  s.data ->> 'personal_name',
  s.data ->> 'birth_date',
  s.data ->> 'death_date',
  catalog.text_value(s.data -> 'bio'),
  catalog.jsonb_bigint(s.data -> 'photos' -> 0)
FROM catalog.stage_authors s
WHERE s.data ->> 'name' IS NOT NULL
ON CONFLICT (ol_key) DO NOTHING;

-- Tell the planner what just landed.
--
-- Nothing updates statistics inside a transaction, so every statement below
-- would otherwise plan against the catalog as it was before the TRUNCATE. On
-- the first full run that meant the planner believed catalog.authors held
-- 1,269 rows in 12 pages when it held 15,380,614 — four orders of magnitude
-- out. An EXISTS against a table that small looks free to hash, so the plan
-- built a hash of 15 million rows, blew through work_mem and spilled to disk
-- in batches; the work_authors insert ran for over four hours against roughly
-- thirty minutes when it had usable estimates.
--
-- ANALYZE is transaction-safe, sees the uncommitted rows, and takes seconds.
ANALYZE catalog.authors_new;

-- ---------------------------------------------------------------------------
-- Works
-- ---------------------------------------------------------------------------
--
-- The search_vector trigger is off for the insert.
--
-- It fires on INSERT and again when author_names is assigned below, so every
-- work had its tsvector built twice — four to_tsvector calls, an unaccent and
-- two normalisations, 41.5 million times over, and then all of it again. The
-- first pass is pure waste: author_names is still NULL at insert time, so the
-- vector it produces is incomplete and is immediately replaced.
--
-- Skipping it here also keeps the inserted rows small, which matters when the
-- statement is already bound by WAL.
--
-- Nothing to disable: CREATE TABLE ... LIKE does not copy triggers, so
-- works_new starts without one and the insert is naturally trigger-free. The
-- trigger is created below, before author_names is assigned, so the vector is
-- still built by exactly one piece of code and nothing here duplicates it.

INSERT INTO catalog.works_new (
  ol_key, title, subtitle, description, first_publish_year, subjects, updated_at
)
SELECT
  s.ol_key,
  s.data ->> 'title',
  s.data ->> 'subtitle',
  catalog.text_value(s.data -> 'description'),
  catalog.publish_year(s.data ->> 'first_publish_date'),
  -- Subjects longer than 300 characters are not subjects. Open Library's
  -- arrays occasionally carry a blurb or citation string — the longest seen is
  -- 5,200 characters — and GIN cannot index an element that large, so the
  -- subjects index fails outright with 54000 unless they are dropped here.
  CASE
    WHEN jsonb_typeof(s.data -> 'subjects') = 'array'
      THEN ARRAY(
        SELECT v FROM jsonb_array_elements_text(s.data -> 'subjects') AS v
        WHERE length(v) <= 300
      )
    ELSE '{}'::text[]
  END,
  now()
FROM catalog.stage_works s
WHERE s.data ->> 'title' IS NOT NULL
ON CONFLICT (ol_key) DO NOTHING;

-- work_authors joins staged works against both tables above, so both need
-- honest statistics before it runs.
ANALYZE catalog.works_new;

-- Work authors are [{author: {key}}]; edition authors are [{key}]. Different
-- shapes, and only the work shape is authoritative for authorship.
INSERT INTO catalog.work_authors_new (work_key, author_key, position)
SELECT DISTINCT ON (s.ol_key, author_key)
  s.ol_key,
  author_key,
  (elem.ordinality - 1)::int
FROM catalog.stage_works s
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(s.data -> 'authors') = 'array'
       THEN s.data -> 'authors' ELSE '[]'::jsonb END
) WITH ORDINALITY AS elem(value, ordinality)
CROSS JOIN LATERAL (
  SELECT regexp_replace(
    coalesce(elem.value #>> '{author,key}', elem.value ->> 'key', ''), '^.*/', ''
  ) AS author_key
) k
WHERE k.author_key <> ''
  AND EXISTS (SELECT 1 FROM catalog.works_new w WHERE w.ol_key = s.ol_key)
  AND EXISTS (SELECT 1 FROM catalog.authors_new a WHERE a.ol_key = k.author_key)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
ANALYZE catalog.work_authors_new;

-- Editions
-- ---------------------------------------------------------------------------
--
-- The slice predicates are applied HERE, not only in 04-slice.sql.
--
-- Building every edition and then deleting most of them is the single most
-- expensive thing this pipeline did. With the default slice, 10.1% of editions
-- survive: inserting all 56.6 million and letting slice remove 51 million
-- means writing ten rows, and their WAL, for every one kept. The first full
-- run spent over three hours on this statement alone.
--
-- 04-slice.sql remains the authority and still runs — it applies the
-- work-level rules (an author, a surviving edition) that cannot be known until
-- the editions exist, and re-applies these edition rules harmlessly against a
-- set that already satisfies them. That keeps re-running slice alone with a
-- different config correct. What follows is a pre-filter for speed, driven by
-- exactly the same psql variables, so the two cannot disagree about what the
-- config means.
WITH candidate AS (
  SELECT
    s.ol_key,
    w.work_key,
    s.data ->> 'title'    AS title,
    s.data ->> 'subtitle' AS subtitle,
    -- Prefer a valid isbn_13; otherwise derive one from isbn_10 so every join
    -- uses a single canonical key.
    CASE
      WHEN catalog.is_valid_isbn13(catalog.clean_isbn(s.data -> 'isbn_13' ->> 0))
        THEN catalog.clean_isbn(s.data -> 'isbn_13' ->> 0)
      ELSE catalog.isbn10_to_13(s.data -> 'isbn_10' ->> 0)
    END AS isbn13,
    CASE
      WHEN catalog.clean_isbn(s.data -> 'isbn_10' ->> 0) ~ '^[0-9]{9}[0-9X]$'
        THEN catalog.clean_isbn(s.data -> 'isbn_10' ->> 0)
      ELSE NULL
    END AS isbn10,
    CASE WHEN jsonb_typeof(s.data -> 'publishers') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(s.data -> 'publishers'))
         ELSE '{}'::text[] END AS publishers,
    s.data ->> 'publish_date' AS publish_date_raw,
    catalog.publish_year(s.data ->> 'publish_date') AS publish_year,
    CASE WHEN jsonb_typeof(s.data -> 'number_of_pages') = 'number'
         THEN (s.data ->> 'number_of_pages')::int ELSE NULL END AS number_of_pages,
    CASE WHEN jsonb_typeof(s.data -> 'languages') = 'array'
         THEN ARRAY(SELECT regexp_replace(value ->> 'key', '^.*/', '')
                    FROM jsonb_array_elements(s.data -> 'languages') AS value)
         ELSE '{}'::text[] END AS languages,
    s.data ->> 'physical_format' AS physical_format,
    catalog.jsonb_bigint(s.data -> 'covers' -> 0) AS cover_id
  FROM catalog.stage_editions s
  LEFT JOIN LATERAL (
    SELECT regexp_replace(s.data -> 'works' -> 0 ->> 'key', '^.*/', '') AS work_key
  ) w ON true
  WHERE s.data ->> 'title' IS NOT NULL
    AND (w.work_key IS NULL
         OR EXISTS (SELECT 1 FROM catalog.works_new cw WHERE cw.ol_key = w.work_key))
)
INSERT INTO catalog.editions_new (
  ol_key, work_key, title, subtitle, isbn13, isbn10, publishers,
  publish_date_raw, publish_year, number_of_pages, languages,
  physical_format, cover_id, updated_at
)
SELECT
  ol_key, work_key, title, subtitle, isbn13, isbn10, publishers,
  publish_date_raw, publish_year, number_of_pages, languages,
  physical_format, cover_id, now()
FROM candidate
-- Mirrors the DELETE in 04-slice.sql, expressed as what to keep.
WHERE (:'require_isbn' <> 'true' OR isbn13 IS NOT NULL)
  AND (:'require_cover' <> 'true' OR cover_id IS NOT NULL)
  AND (publish_year IS NULL OR publish_year >= :min_publish_year)
  AND (
        (:'languages')::text[] = '{}'
        OR languages = '{}'
        OR languages && (:'languages')::text[]
      )
ON CONFLICT (ol_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Denormalized fields
-- ---------------------------------------------------------------------------
-- The aggregates below scan editions and work_authors in full.
ANALYZE catalog.editions_new;

-- edition_count, used for slicing and for ranking.
UPDATE catalog.works_new w
SET edition_count = c.n
FROM (SELECT work_key, count(*) AS n FROM catalog.editions_new
      WHERE work_key IS NOT NULL GROUP BY work_key) c
WHERE w.ol_key = c.work_key;

-- Referential integrity between the new tables. LIKE does not copy foreign
-- keys, and the names are per-table rather than per-schema, so they can be
-- canonical from the start and survive the rename untouched.
--
-- The clauses must match the migrations exactly, including ON UPDATE. A first
-- attempt omitted ON UPDATE CASCADE and guessed SET NULL for editions; both
-- were caught by diffing the swapped database against the datamodel, which is
-- the check that makes this approach safe rather than merely plausible.
ALTER TABLE catalog.work_authors_new
  ADD CONSTRAINT work_authors_work_key_fkey
  FOREIGN KEY (work_key) REFERENCES catalog.works_new(ol_key)
  ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE catalog.work_authors_new
  ADD CONSTRAINT work_authors_author_key_fkey
  FOREIGN KEY (author_key) REFERENCES catalog.authors_new(ol_key)
  ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE catalog.editions_new
  ADD CONSTRAINT editions_work_key_fkey
  FOREIGN KEY (work_key) REFERENCES catalog.works_new(ol_key)
  ON UPDATE CASCADE ON DELETE CASCADE;

-- Drop the works outside the slice now, before the expensive passes.
--
-- 04-slice.sql used to do this after the swap, and the point of moving it is
-- runtime, not space. cover_edition_key and author_names below now run over the
-- ~6.9M works that survive rather than all 41.5M; author_names was the longest
-- statement in the first full run at six hours twenty, and it fires the
-- search_vector trigger for every row it touches.
--
-- It does NOT remove the bloat, and it is worth saying so plainly because the
-- opposite is the intuitive guess. Deleting here leaves dead tuples in
-- works_new, and renaming a table does not compact it — the dead space simply
-- arrives under the new name. Measured on a fixture: one live row, five dead,
-- after the swap.
--
-- Removing the bloat needs the non-qualifying works never to be inserted,
-- which means deciding the surviving work set from staging before works are
-- built. That is a larger restructure: the edition filters would have to be
-- materialised first, min_editions becomes a count over them, and require_author
-- becomes a check against the staged authors array. Until then a full rebuild
-- still wants a VACUUM FULL — see R2b in PRD.md.
--
-- 04-slice.sql remains the authority and still runs — re-running it alone with
-- a narrower config has to keep working — and finds nothing left to do when the
-- config is unchanged. Same arrangement as the edition predicates.
--
-- Deleting a work cascades to its author links and its editions, which is what
-- slice relied on too — hence the foreign keys directly above. A first attempt
-- added them after this delete and the ALTER failed validating rows that
-- pointed at works already gone: the cascade only exists once the constraint
-- does. They are still added after the bulk inserts, so those are not paying
-- per-row checks.
DELETE FROM catalog.works_new w
WHERE w.edition_count < :min_editions
   OR (:'require_author' = 'true'
       AND NOT EXISTS (
         SELECT 1 FROM catalog.work_authors_new wa WHERE wa.work_key = w.ol_key
       ));

-- Authors with nothing left to their name.
DELETE FROM catalog.authors_new a
WHERE NOT EXISTS (
  SELECT 1 FROM catalog.work_authors_new wa WHERE wa.author_key = a.ol_key
);

-- The tables just lost most of their rows, so the estimates the planner has
-- for the passes below are now wrong by an order of magnitude.
ANALYZE catalog.works_new;
ANALYZE catalog.authors_new;
ANALYZE catalog.work_authors_new;
ANALYZE catalog.editions_new;

-- The dump has no cover_edition_key (that field comes from the search API).
-- Derive it: the earliest edition that actually has a cover.
UPDATE catalog.works_new w
SET cover_edition_key = e.ol_key
FROM (
  SELECT DISTINCT ON (work_key) work_key, ol_key
  FROM catalog.editions_new
  WHERE work_key IS NOT NULL AND cover_id IS NOT NULL
  ORDER BY work_key, publish_year NULLS LAST, ol_key
) e
WHERE w.ol_key = e.work_key;

-- Author names, denormalized for search. Joining through work_authors on every
-- query is too slow at a million rows. Assigning this fires the search_vector
-- trigger, which is what populates the FTS column — and now the only thing
-- that does, since the insert above ran without it.
CREATE TRIGGER works_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, subtitle, author_names, subjects
  ON catalog.works_new
  FOR EACH ROW EXECUTE FUNCTION catalog.works_search_vector_update();

UPDATE catalog.works_new w
SET author_names = a.names
FROM (
  SELECT wa.work_key, string_agg(au.name, ', ' ORDER BY wa.position) AS names
  FROM catalog.work_authors_new wa
  JOIN catalog.authors_new au ON au.ol_key = wa.author_key
  GROUP BY wa.work_key
) a
WHERE w.ol_key = a.work_key;

-- Works with no authors never received an author_names assignment above, so
-- their search_vector is still unset — and with the trigger off during the
-- insert, unset is now the only state they can be in. Touch them so the
-- trigger runs.
UPDATE catalog.works_new SET author_names = NULL WHERE search_vector IS NULL;

-- Record ISBNs in the identity table so cross-source lookups have one path.
INSERT INTO catalog.external_ids_new (entity_type, entity_key, source, external_id)
SELECT 'edition', ol_key, 'isbn', isbn13
FROM catalog.editions_new WHERE isbn13 IS NOT NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Swap
-- ---------------------------------------------------------------------------
--
-- Everything above touched only the _new tables, so readers have been served
-- the old catalog throughout. This is the only part that takes an exclusive
-- lock, and it holds it for the length of five drops and five renames rather
-- than the length of a rebuild.
--
-- It waits for in-flight readers and briefly queues new ones. That is the
-- trade: a pause measured in milliseconds instead of an outage measured in
-- hours.
DROP TABLE
  catalog.external_ids, catalog.editions, catalog.work_authors,
  catalog.works, catalog.authors CASCADE;

ALTER TABLE catalog.authors_new      RENAME TO authors;
ALTER TABLE catalog.works_new        RENAME TO works;
ALTER TABLE catalog.work_authors_new RENAME TO work_authors;
ALTER TABLE catalog.editions_new     RENAME TO editions;
ALTER TABLE catalog.external_ids_new RENAME TO external_ids;

-- Index names are per-schema and ALTER TABLE ... RENAME does not touch them,
-- so every index is still called <table>_new_<something>. Left alone they
-- would drift from the migration history for ever, and `prisma migrate diff`
-- would propose dropping and recreating each one.
--
-- Done by loop rather than by hand: there are thirteen today, and a hand-written
-- list is a maintenance trap — the next person to add an index would have to
-- remember to add a rename too, and nothing would fail if they forgot.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS old_name,
           replace(c.relname, t.relname || '_new_', t.relname || '_') AS new_name
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'catalog'
      AND t.relname IN ('authors','works','work_authors','editions','external_ids')
      AND c.relname LIKE '%\_new\_%'
  LOOP
    EXECUTE format('ALTER INDEX catalog.%I RENAME TO %I', r.old_name, r.new_name);
  END LOOP;
END
$$;

-- The primary key indexes are named <table>_new_pkey, which the pattern above
-- does not match: there is no trailing segment after "_new".
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS old_name,
           replace(c.relname, '_new_pkey', '_pkey') AS new_name
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'catalog'
      AND t.relname IN ('authors','works','work_authors','editions','external_ids')
      AND c.relname LIKE '%\_new\_pkey'
  LOOP
    EXECUTE format('ALTER INDEX catalog.%I RENAME TO %I', r.old_name, r.new_name);
  END LOOP;
END
$$;

-- Nothing should be left carrying the temporary name. Failing here is far
-- better than committing a catalog that silently disagrees with its migrations.
DO $$
DECLARE
  stragglers text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO stragglers
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'catalog' AND c.relname LIKE '%\_new\_%';

  IF stragglers IS NOT NULL THEN
    RAISE EXCEPTION 'swap left objects named after the temporary tables: %', stragglers;
  END IF;
END
$$;

COMMIT;
