-- catalog.jsonb_bigint — read a JSON value as a bigint, or NULL.
--
-- The ingest reads cover and photo ids as `(data->'covers'->0)::text::bigint`.
-- Open Library emits JSON null in those arrays — 933 editions in the
-- 2026-07-31 dump carry "covers": [null] — and a JSON null is not a SQL NULL:
-- casting it to text yields the four-character string 'null', so the cast
-- fails with
--
--   invalid input syntax for type bigint: "null"
--
-- 03-normalize.sql is one transaction over ~100 million rows, so those 933
-- rows would abort the whole run after tens of minutes, reporting a type
-- rather than a record.
--
-- IMMUTABLE and STRICT so it can be used freely in the ingest's set-based
-- passes without blocking parallelism.
CREATE OR REPLACE FUNCTION catalog.jsonb_bigint(value jsonb)
RETURNS bigint AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) = 'number'
      -- Still guard the cast: a JSON number may be fractional or wider than
      -- bigint, and both would raise here rather than return NULL.
      AND value::text ~ '^-?[0-9]{1,18}$'
    THEN value::text::bigint
    ELSE NULL
  END
$$ LANGUAGE sql IMMUTABLE STRICT;
