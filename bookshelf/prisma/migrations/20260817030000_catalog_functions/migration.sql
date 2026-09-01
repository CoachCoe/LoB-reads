-- Catalog helper functions.
--
-- These are schema objects, so they belong in a migration rather than being
-- created as a side effect of running the normalize script. Keeping them here
-- means a freshly migrated database — including the one CI builds for the
-- integration tests — has them before any ingest runs.

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
