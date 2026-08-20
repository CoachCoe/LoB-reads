-- Index for the discover page's "most editions first" ordering.
--
-- getPopularWorks orders every work by edition_count and takes 24. With no
-- matching index that is a full sort of 6.9M rows — an external merge spilling
-- roughly 480MB to disk — measured at 1,976ms. The column order matches the
-- query's ORDER BY exactly so the sort becomes an index scan of 24 rows.
CREATE INDEX IF NOT EXISTS "works_edition_count_ol_key_idx"
  ON "catalog"."works" ("edition_count" DESC, "ol_key");
