-- Restore the FTS and trigram indexes that the M3 migration dropped.
--
-- They were hand-written into the M1 migration, which made them invisible to
-- `prisma migrate diff` — so the next diff generated a DROP for all three.
-- Nothing failed: search still returns correct results from a sequential scan,
-- and the M2 latency test did not notice because 4,000 rows seq-scan in about
-- ten milliseconds. At catalog scale it would not have been subtle.
--
-- They are declared in schema.prisma now, so Prisma owns them and cannot
-- propose dropping them again. IF NOT EXISTS so this is safe on a database
-- built after that declaration.

CREATE INDEX IF NOT EXISTS "works_search_vector_idx"
  ON "catalog"."works" USING GIN ("search_vector");

CREATE INDEX IF NOT EXISTS "works_title_idx"
  ON "catalog"."works" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "works_author_names_idx"
  ON "catalog"."works" USING GIN ("author_names" gin_trgm_ops);
