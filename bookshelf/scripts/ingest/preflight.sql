-- Pre-flight — check the staged data against the casts normalize will perform.
--
--   psql "$DIRECT_URL" -f scripts/ingest/preflight.sql
--
-- 03-normalize.sql is a single transaction over tens of millions of rows. A
-- cast that fails on one row aborts all of it, after however long it had been
-- running, and the failure names a type rather than a record — so the next
-- question is always "which row?", asked from a standing start.
--
-- Every query below reports rows that WOULD break a specific cast, cheaply and
-- outside a transaction. All zeros means normalize's assumptions hold for this
-- particular dump, which is the only place those assumptions can be confirmed:
-- the shapes vary by publication, and the fixtures cannot represent them.

\echo '── authors ─────────────────────────────'

-- (data->'photos'->0)::text::bigint
SELECT count(*) AS "photos[0] not a number (breaks ::bigint)"
FROM catalog.stage_authors
WHERE data->'photos'->0 IS NOT NULL
  AND jsonb_typeof(data->'photos'->0) <> 'number';

-- A JSON number may still be fractional or wider than bigint.
SELECT count(*) AS "photos[0] number but not an integer"
FROM catalog.stage_authors
WHERE jsonb_typeof(data->'photos'->0) = 'number'
  AND (data->>'photos') !~ '^\[\s*-?[0-9]+';

\echo '── works ───────────────────────────────'

SELECT count(*) AS "title present but not a string"
FROM catalog.stage_works
WHERE data->'title' IS NOT NULL AND jsonb_typeof(data->'title') <> 'string';

-- ARRAY(SELECT jsonb_array_elements_text(...)) requires an array of scalars.
SELECT count(*) AS "subjects array containing non-scalars"
FROM catalog.stage_works s
WHERE jsonb_typeof(s.data->'subjects') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(s.data->'subjects') e
    WHERE jsonb_typeof(e.value) IN ('object','array')
  );

\echo '── editions ────────────────────────────'

-- (data->'covers'->0)::text::bigint
SELECT count(*) AS "covers[0] not a number (breaks ::bigint)"
FROM catalog.stage_editions
WHERE data->'covers'->0 IS NOT NULL
  AND jsonb_typeof(data->'covers'->0) <> 'number';

-- (data->>'number_of_pages')::int, guarded only by jsonb_typeof = 'number'.
-- A JSON number can be fractional or far outside int4, and both break the cast.
SELECT count(*) AS "number_of_pages fractional (breaks ::int)"
FROM catalog.stage_editions
WHERE jsonb_typeof(data->'number_of_pages') = 'number'
  AND (data->>'number_of_pages') ~ '[.eE]';

SELECT count(*) AS "number_of_pages outside int4 range"
FROM catalog.stage_editions
WHERE jsonb_typeof(data->'number_of_pages') = 'number'
  AND (data->>'number_of_pages') !~ '[.eE]'
  AND abs((data->>'number_of_pages')::numeric) > 2147483647;

-- languages is [{key: /languages/eng}]; a bare string would yield NULL keys.
SELECT count(*) AS "languages entries that are not objects"
FROM catalog.stage_editions s
WHERE jsonb_typeof(s.data->'languages') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(s.data->'languages') e
    WHERE jsonb_typeof(e.value) <> 'object'
  );

-- works is [{key: /works/OL...W}]; the edition is orphaned without it.
SELECT count(*) AS "editions with no work reference"
FROM catalog.stage_editions
WHERE data->'works'->0->>'key' IS NULL;
