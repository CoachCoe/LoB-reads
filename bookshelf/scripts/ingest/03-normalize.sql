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

-- ---------------------------------------------------------------------------
-- Helper: ISBN canonicalization
-- ---------------------------------------------------------------------------
-- Every cross-source join keys on ISBN-13. ISBN-10s are converted rather than
-- stored as a second dialect, so one canonical key covers all of them.

CREATE OR REPLACE FUNCTION catalog.clean_isbn(raw text)
RETURNS text AS $$
  SELECT upper(regexp_replace(coalesce(raw, ''), '[^0-9Xx]', '', 'g'));
$$ LANGUAGE sql IMMUTABLE;

-- ISBN-10 -> ISBN-13: prefix 978, then recompute the check digit.
CREATE OR REPLACE FUNCTION catalog.isbn10_to_13(isbn10 text)
RETURNS text AS $$
DECLARE
  body   text;
  total  int := 0;
  i      int;
  check_digit int;
BEGIN
  body := catalog.clean_isbn(isbn10);
  IF body !~ '^[0-9]{9}[0-9X]$' THEN
    RETURN NULL;
  END IF;

  body := '978' || substring(body from 1 for 9);

  FOR i IN 1..12 LOOP
    total := total + substring(body from i for 1)::int * CASE WHEN i % 2 = 0 THEN 3 ELSE 1 END;
  END LOOP;

  check_digit := (10 - (total % 10)) % 10;
  RETURN body || check_digit::text;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Validate an ISBN-13 check digit, so malformed source data is dropped rather
-- than stored and joined against.
CREATE OR REPLACE FUNCTION catalog.is_valid_isbn13(isbn text)
RETURNS boolean AS $$
DECLARE
  total int := 0;
  i     int;
BEGIN
  IF isbn IS NULL OR isbn !~ '^[0-9]{13}$' THEN
    RETURN false;
  END IF;
  FOR i IN 1..12 LOOP
    total := total + substring(isbn from i for 1)::int * CASE WHEN i % 2 = 0 THEN 3 ELSE 1 END;
  END LOOP;
  RETURN ((10 - (total % 10)) % 10) = substring(isbn from 13 for 1)::int;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- `description` and `bio` are sometimes a plain string and sometimes
-- {type: "/type/text", value: "..."}. Coalesce both shapes.
CREATE OR REPLACE FUNCTION catalog.text_value(field jsonb)
RETURNS text AS $$
  SELECT CASE
    WHEN field IS NULL THEN NULL
    WHEN jsonb_typeof(field) = 'string' THEN field #>> '{}'
    WHEN jsonb_typeof(field) = 'object' THEN field ->> 'value'
    ELSE NULL
  END;
$$ LANGUAGE sql IMMUTABLE;

-- publish_date is free text: "1965", "October 1, 1965", "1965-10-01", "n.d.".
-- Extract a 4-digit year if one is present and plausible; keep the raw string
-- either way. Do not attempt to parse it fully.
CREATE OR REPLACE FUNCTION catalog.publish_year(raw text)
RETURNS int AS $$
DECLARE
  match text;
  year  int;
BEGIN
  match := substring(coalesce(raw, '') from '(1[0-9]{3}|20[0-9]{2})');
  IF match IS NULL THEN RETURN NULL; END IF;
  year := match::int;
  IF year < 1000 OR year > extract(year FROM now())::int + 1 THEN
    RETURN NULL;
  END IF;
  RETURN year;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ---------------------------------------------------------------------------
-- Authors
-- ---------------------------------------------------------------------------
TRUNCATE catalog.works, catalog.editions, catalog.work_authors, catalog.authors CASCADE;

INSERT INTO catalog.authors (ol_key, name, personal_name, birth_date, death_date, bio, photo_id)
SELECT
  s.ol_key,
  coalesce(s.data ->> 'name', '(unknown)'),
  s.data ->> 'personal_name',
  s.data ->> 'birth_date',
  s.data ->> 'death_date',
  catalog.text_value(s.data -> 'bio'),
  (s.data -> 'photos' -> 0)::text::bigint
FROM catalog.stage_authors s
WHERE s.data ->> 'name' IS NOT NULL
ON CONFLICT (ol_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Works
-- ---------------------------------------------------------------------------
INSERT INTO catalog.works (
  ol_key, title, subtitle, description, first_publish_year, subjects, updated_at
)
SELECT
  s.ol_key,
  s.data ->> 'title',
  s.data ->> 'subtitle',
  catalog.text_value(s.data -> 'description'),
  catalog.publish_year(s.data ->> 'first_publish_date'),
  CASE
    WHEN jsonb_typeof(s.data -> 'subjects') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(s.data -> 'subjects'))
    ELSE '{}'::text[]
  END,
  now()
FROM catalog.stage_works s
WHERE s.data ->> 'title' IS NOT NULL
ON CONFLICT (ol_key) DO NOTHING;

-- Work authors are [{author: {key}}]; edition authors are [{key}]. Different
-- shapes, and only the work shape is authoritative for authorship.
INSERT INTO catalog.work_authors (work_key, author_key, position)
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
  AND EXISTS (SELECT 1 FROM catalog.works w WHERE w.ol_key = s.ol_key)
  AND EXISTS (SELECT 1 FROM catalog.authors a WHERE a.ol_key = k.author_key)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Editions
-- ---------------------------------------------------------------------------
INSERT INTO catalog.editions (
  ol_key, work_key, title, subtitle, isbn13, isbn10, publishers,
  publish_date_raw, publish_year, number_of_pages, languages,
  physical_format, cover_id, updated_at
)
SELECT
  s.ol_key,
  w.work_key,
  s.data ->> 'title',
  s.data ->> 'subtitle',
  -- Prefer a valid isbn_13; otherwise derive one from isbn_10 so every join
  -- uses a single canonical key.
  CASE
    WHEN catalog.is_valid_isbn13(catalog.clean_isbn(s.data -> 'isbn_13' ->> 0))
      THEN catalog.clean_isbn(s.data -> 'isbn_13' ->> 0)
    ELSE catalog.isbn10_to_13(s.data -> 'isbn_10' ->> 0)
  END,
  CASE
    WHEN catalog.clean_isbn(s.data -> 'isbn_10' ->> 0) ~ '^[0-9]{9}[0-9X]$'
      THEN catalog.clean_isbn(s.data -> 'isbn_10' ->> 0)
    ELSE NULL
  END,
  CASE WHEN jsonb_typeof(s.data -> 'publishers') = 'array'
       THEN ARRAY(SELECT jsonb_array_elements_text(s.data -> 'publishers'))
       ELSE '{}'::text[] END,
  s.data ->> 'publish_date',
  catalog.publish_year(s.data ->> 'publish_date'),
  CASE WHEN jsonb_typeof(s.data -> 'number_of_pages') = 'number'
       THEN (s.data ->> 'number_of_pages')::int ELSE NULL END,
  CASE WHEN jsonb_typeof(s.data -> 'languages') = 'array'
       THEN ARRAY(SELECT regexp_replace(value ->> 'key', '^.*/', '')
                  FROM jsonb_array_elements(s.data -> 'languages') AS value)
       ELSE '{}'::text[] END,
  s.data ->> 'physical_format',
  (s.data -> 'covers' -> 0)::text::bigint,
  now()
FROM catalog.stage_editions s
LEFT JOIN LATERAL (
  SELECT regexp_replace(s.data -> 'works' -> 0 ->> 'key', '^.*/', '') AS work_key
) w ON true
WHERE s.data ->> 'title' IS NOT NULL
  AND (w.work_key IS NULL
       OR EXISTS (SELECT 1 FROM catalog.works cw WHERE cw.ol_key = w.work_key))
ON CONFLICT (ol_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Denormalized fields
-- ---------------------------------------------------------------------------

-- edition_count, used for slicing and for ranking.
UPDATE catalog.works w
SET edition_count = c.n
FROM (SELECT work_key, count(*) AS n FROM catalog.editions
      WHERE work_key IS NOT NULL GROUP BY work_key) c
WHERE w.ol_key = c.work_key;

-- The dump has no cover_edition_key (that field comes from the search API).
-- Derive it: the earliest edition that actually has a cover.
UPDATE catalog.works w
SET cover_edition_key = e.ol_key
FROM (
  SELECT DISTINCT ON (work_key) work_key, ol_key
  FROM catalog.editions
  WHERE work_key IS NOT NULL AND cover_id IS NOT NULL
  ORDER BY work_key, publish_year NULLS LAST, ol_key
) e
WHERE w.ol_key = e.work_key;

-- Author names, denormalized for search. Joining through work_authors on every
-- query is too slow at a million rows. Assigning this fires the search_vector
-- trigger, which is what populates the FTS column.
UPDATE catalog.works w
SET author_names = a.names
FROM (
  SELECT wa.work_key, string_agg(au.name, ', ' ORDER BY wa.position) AS names
  FROM catalog.work_authors wa
  JOIN catalog.authors au ON au.ol_key = wa.author_key
  GROUP BY wa.work_key
) a
WHERE w.ol_key = a.work_key;

-- Works with no authors never received an author_names assignment above, so
-- their search_vector is still unset. Touch them so the trigger runs.
UPDATE catalog.works SET author_names = NULL WHERE search_vector IS NULL;

-- Record ISBNs in the identity table so cross-source lookups have one path.
INSERT INTO catalog.external_ids (entity_type, entity_key, source, external_id)
SELECT 'edition', ol_key, 'isbn', isbn13
FROM catalog.editions WHERE isbn13 IS NOT NULL
ON CONFLICT DO NOTHING;

COMMIT;
