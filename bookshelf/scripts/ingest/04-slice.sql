-- Stage 4 — slice.
--
-- Deletes everything outside the configured slice. Driven by config/slice.yaml
-- via psql variables, so widening the catalog is a config change plus a re-run,
-- never an edit to this file.
--
--   psql "$DIRECT_URL" \
--     -v min_publish_year=1900 -v languages="{eng}" -v require_isbn=true \
--     -v require_cover=false -v require_author=true -v min_editions=1 \
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

-- Authors with nothing left to their name are dead weight.
DELETE FROM catalog.authors a
WHERE NOT EXISTS (SELECT 1 FROM catalog.work_authors wa WHERE wa.author_key = a.ol_key);

-- Identity rows for editions that no longer exist.
DELETE FROM catalog.external_ids x
WHERE x.entity_type = 'edition'
  AND NOT EXISTS (SELECT 1 FROM catalog.editions e WHERE e.ol_key = x.entity_key);

COMMIT;
