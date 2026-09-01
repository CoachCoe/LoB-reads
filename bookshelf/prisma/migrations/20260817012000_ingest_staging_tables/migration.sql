-- Staging tables for the Open Library ingest.
--
-- UNLOGGED: these are rebuilt from the dumps on every run, so there is no
-- point paying for WAL. They are deliberately dumb — key plus raw jsonb —
-- with all projection deferred to the normalize step.
--
-- Not modelled in schema.prisma: they are scratch space, not application data,
-- and Prisma would otherwise treat a TRUNCATE-and-reload as schema drift.

CREATE UNLOGGED TABLE IF NOT EXISTS catalog.stage_authors (
  ol_key        text PRIMARY KEY,
  revision      int,
  last_modified timestamptz,
  data          jsonb NOT NULL
);

CREATE UNLOGGED TABLE IF NOT EXISTS catalog.stage_works (
  ol_key        text PRIMARY KEY,
  revision      int,
  last_modified timestamptz,
  data          jsonb NOT NULL
);

CREATE UNLOGGED TABLE IF NOT EXISTS catalog.stage_editions (
  ol_key        text PRIMARY KEY,
  revision      int,
  last_modified timestamptz,
  data          jsonb NOT NULL
);
