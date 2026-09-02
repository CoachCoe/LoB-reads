-- Provenance for the "Readers also enjoyed" graph.
--
-- SPEC-3. The work page rendered <CorpusAttribution /> under that section
-- unconditionally, crediting goodbooks-10k and asserting CC BY-SA 4.0. At the
-- documented default — ENABLE_SEED_DATA unset — computeSimilarity builds the
-- graph purely from app.reviews, so the page was claiming a viral ShareAlike
-- licence over readers' own reviews.
--
-- That is the inverse of the error the OQ-1/OQ-2 work fixed: over-claiming
-- rather than under-claiming. Under-claiming risks a licence breach;
-- over-claiming misstates the terms on which readers' own content is held.
--
-- Per pair, not a flag on the table, because that is the honest granularity and
-- it matches what the rating surface already does. Even with the corpus
-- included, a given pair's co-raters may all be real readers — and then no
-- credit is owed for that pair. The page gates on `seed_co_raters > 0` exactly
-- as it gates the rating on `seedCount > 0`.
--
-- Nullable with no backfill: the table is TRUNCATEd and recomputed in full by
-- `npm run social:stats`, so any existing row is about to be replaced. NULL
-- therefore means "computed before provenance was recorded", which the read path
-- treats as unknown — and unknown must attribute, because a graph that might
-- contain corpus data has to be credited.

ALTER TABLE "catalog"."work_similarity"
  ADD COLUMN IF NOT EXISTS "seed_co_raters" integer;

COMMENT ON COLUMN "catalog"."work_similarity"."seed_co_raters" IS
  'Co-raters for this pair that came from seed.ratings. 0 means the pair is wholly reader-derived and needs no CC BY-SA attribution; NULL means computed before this column existed, which the read path treats as needing attribution.';
