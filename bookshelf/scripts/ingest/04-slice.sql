-- Stage 4 — slice.
--
-- Deletes everything outside the configured slice. Driven by config/slice.yaml
-- via psql variables, so widening the catalog is a config change plus a re-run,
-- never an edit to this file.
--
--   psql "$DIRECT_URL" \
--     -v min_publish_year=1900 -v languages="{eng}" -v require_isbn=true \
--     -v require_cover=false -v require_author=true -v min_editions=1 \
--     -v must_appear_in_rating_corpus=false \
--     -f scripts/ingest/04-slice.sql
--
-- Deletion cascades: removing a work removes its editions and author links.

BEGIN;

-- Editions first: a work's eligibility depends on which of its editions survive.
DELETE FROM catalog.editions e
WHERE (:'require_isbn' = 'true' AND e.isbn13 IS NULL)
   OR (:'require_cover' = 'true' AND e.cover_id IS NULL)
   OR (e.publish_year IS NOT NULL AND e.publish_year < :min_publish_year)
   OR (
        :'languages' <> '{}'
        AND e.languages <> '{}'
        AND NOT (e.languages && (:'languages')::text[])
      );

-- Recount before filtering works on edition count.
-- Only touch rows whose count actually changed.
--
-- Without the last predicate this rewrites every work — 41.5 million of them —
-- whether or not the value differs. After a bulk load the pages have no free
-- space, so none of those rewrites can be HOT, and each one therefore updates
-- all three GIN indexes on the table. It ran for nearly two hours before being
-- cancelled, doing nothing: normalize had already computed edition_count, and
-- the DELETE above removed no editions because normalize now applies the same
-- edition predicates as it builds.
--
-- IS DISTINCT FROM rather than <> so a NULL count is compared, not skipped.
UPDATE catalog.works w SET edition_count = coalesce(c.n, 0)
FROM (SELECT ol_key FROM catalog.works) all_w
LEFT JOIN LATERAL (
  SELECT count(*) AS n FROM catalog.editions WHERE work_key = all_w.ol_key
) c ON true
WHERE w.ol_key = all_w.ol_key
  AND w.edition_count IS DISTINCT FROM coalesce(c.n, 0);

DELETE FROM catalog.works w
WHERE w.edition_count < :min_editions
   OR (:'require_author' = 'true'
       AND NOT EXISTS (SELECT 1 FROM catalog.work_authors wa WHERE wa.work_key = w.ol_key));

-- Optionally, keep only works someone has actually rated.
--
-- This turns the catalog into roughly the size of the rating corpus — about
-- 8,700 works against 6.9 million — which is a fixture, not a library. It
-- exists because a catalog with ratings on every work is useful for testing
-- recommendations, and because it was once the plan for fitting the AWS free
-- tier. That second reason no longer applies: the full sliced catalog is 11GB
-- and fits 20GB comfortably.
--
-- The guard matters more than the filter. With an empty corpus every work
-- fails the test, so a flag set on a database that has never run
-- `social:load` would delete the entire catalog and report success. It refuses
-- instead.
-- \if rather than a condition inside the block: psql does not interpolate
-- variables inside dollar quotes, so `:'must_appear_in_rating_corpus'` reaches
-- the server verbatim and fails to parse. The test has to happen out here.
\if :must_appear_in_rating_corpus
DO $$
DECLARE
  rated bigint;
BEGIN
  SELECT count(DISTINCT work_key) INTO rated FROM seed.ratings;

  IF rated < 1000 THEN
    RAISE EXCEPTION
      'must_appear_in_rating_corpus is set but the rating corpus covers only % works. '
      'Run `npm run social:load -- --download` first; filtering against an empty '
      'corpus would delete the whole catalog.', rated;
  END IF;

  DELETE FROM catalog.works w
  WHERE NOT EXISTS (SELECT 1 FROM seed.ratings r WHERE r.work_key = w.ol_key);

  RAISE NOTICE 'rating-corpus filter kept works rated by the % in seed.ratings', rated;
END
$$;
\endif

-- Authors with nothing left to their name are dead weight.
DELETE FROM catalog.authors a
WHERE NOT EXISTS (SELECT 1 FROM catalog.work_authors wa WHERE wa.author_key = a.ol_key);

-- Identity rows for editions that no longer exist.
DELETE FROM catalog.external_ids x
WHERE x.entity_type = 'edition'
  AND NOT EXISTS (SELECT 1 FROM catalog.editions e WHERE e.ol_key = x.entity_key);

COMMIT;
