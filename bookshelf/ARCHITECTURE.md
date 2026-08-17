# Architecture

Where things live, why, and — importantly — which parts are mid-migration.

## One book model

`app.books` is gone. User data — shelves, ratings, reviews, reading sessions,
map locations — references catalog works by `work_key`, and display data is
hydrated from `catalog.works` at read time.

The old model conflated a *work* with an *edition*: `isbn` sat on the same row
as `title` and `author`, so two printings of *Dune* were two unrelated rows
with ratings split between them. That is now one work with many editions.

**There is no foreign key from `app` into `catalog`,** deliberately: a bad
ingest must not cascade into user data. Two consequences follow.

1. **Write paths validate explicitly.** `addWorkToShelf` and
   `createOrUpdateReview` check the work exists before inserting; without that,
   a typo becomes a shelf entry that renders blank forever.
2. **Read paths tolerate absence.** An ingest can narrow the slice and drop a
   work someone has shelved. Those render as "not in the current catalog"
   rather than vanishing, and `getWorksByKeys` returns a map with the key
   simply missing.

## Schemas## Schemas

Three, and the separation is a licensing and lifecycle control rather than an
aesthetic one.

```
catalog   rebuilt wholesale from dumps every month — nothing irreplaceable
app       user-owned, survives every ingest
seed      synthetic / restricted-licence, never served (added at M5)
```

Two rules follow from that first line:

1. **Nothing in `app` may hold a foreign key into `catalog`.** A bad ingest
   would cascade into user data. Work keys are plain text columns, validated at
   the application layer.
2. **User-contributed data about a work must be a join table in `app`**, never
   a column on `catalog.works` — a rebuild would erase it. This is why
   third-party enrichment sits in `catalog.enrichment` rather than on the work,
   and why fictional-world associations will move to `app.work_fictional_worlds`.

## Layers

```
src/app/(main)     Server components. Fetch via src/server, render.
src/app/api        Route handlers. Thin: auth, parse, delegate, respond.
src/server         All database access. Throws typed errors.
src/server/catalog Catalog reads: search, work detail, key hydration.
src/lib/http       Request parsing, schemas, error-to-status mapping.
src/lib/auth       NextAuth options, session access, email normalisation.
src/lib/storage    Object storage and upload validation.
src/lib/sources    Third-party integrations (Open Library, Goodreads CSV).
src/lib/*.ts       Cross-cutting infra: prisma, rate-limit, concurrency.
src/components     Presentation.
scripts/ingest     Open Library pipeline. Raw SQL and COPY, not Prisma.
```

**Routes never touch Prisma directly.** They authenticate, parse the body with
a Zod schema, call `src/server`, and map the result. `__tests__/conventions.test.ts`
enforces this, along with the rules that every mutating route authenticates and
that no raw error message reaches a response.

**`src/server` owns queries and authorization.** Ownership checks live here, not
in routes, so they cannot be forgotten per-endpoint. Functions throw
`AuthorizationError`, `NotFoundError` or `ValidationError`; `errorResponse` in
`src/lib/http/api.ts` is the single place those become HTTP statuses.

The one exception is the fictional-world map deletion rule, which needs the
session's `isModerator` flag and therefore lives in the route. It is covered by
`__tests__/integration/map-authorization.test.ts`.

## Why Prisma and raw SQL coexist

Prisma owns the schema and every application query — migrations stay in one
chain and the app layer keeps its types.

The ingest does not use it. Row-by-row inserts across tens of millions of rows
take days where `COPY` takes minutes, and the normalize step is set-based SQL
that has no sensible ORM expression. Catalog helper functions and the search
trigger live in migrations, so a freshly migrated database has them before any
ingest runs.

## Testing

Two suites, separate on purpose:

```
npm test               unit — pure functions and components, offline
npm run test:integration   real Postgres, needs TEST_DATABASE_URL
npm run test:all           both
```

Integration tests **must** run serially (`--runInBand`): they share one
database and truncate between tests. Running them in parallel produces
deadlocks and foreign-key violations, intermittently.

Authorization is tested against a real database rather than a mock, because
what is being tested *is* a query. A mock would assert that our mock returns
what we told it to.

## Search

`src/server/catalog.ts`. Full-text over a weighted `tsvector` (title A, author
B, subtitle C, subjects D), with trigram similarity carrying typos that FTS
cannot match at all.

Ranking is not `ts_rank` alone. Relevance scoring puts "Dune Messiah" level
with "Dune" for the query *dune*, so exact-title and prefix matches carry most
of the weight and relevance only breaks ties. Edition count contributes a
logarithmic nudge, never enough to let a sequel outrank the original.

`unaccent()` is applied on both sides. Indexing the unaccented form and
querying the raw form matches nothing — silently.

Queries go through `websearch_to_tsquery`, which tolerates the punctuation
users actually type. `to_tsquery` raises a syntax error on an apostrophe.

## Exclusive shelves

A work sits on at most one of the three default shelves per user. This is
enforced twice, on purpose.

`addWorkToShelf` deletes from the other exclusive shelves before inserting,
in a transaction. That is the cooperative path and it is not sufficient: two
simultaneous requests each read a state where the other's row does not exist
yet, and both insert.

The database enforces it independently with a partial unique index on
`shelf_items (user_id, work_key) WHERE is_exclusive`. A predicate selecting
exclusive shelves through a subquery is rejected by Postgres, so `is_exclusive`
is denormalized onto the row — and a trigger derives it from the parent shelf
on every write, rather than trusting the caller. Without that trigger the
constraint silently stops applying the moment application code forgets to set
the flag.

Covered by `__tests__/integration/exclusive-shelves.test.ts`. Note that a
single racing test is not enough: with the index dropped it still passed,
because it happened not to interleave. The ten-round version is what fails.

## Known limitations

- **Rate limiting is per-process** (`src/lib/rate-limit.ts`). Correct for a
  single long-lived instance; on serverless the effective limit becomes
  `limit × instances`. The interface is storage-agnostic so swapping in a
  shared store is one file.
- **The `acquire` ingest step is unverified against the live endpoint** —
  it was written where openlibrary.org was unreachable. Start with the
  authors dump (~500MB) rather than editions (~9.2GB).
- **Covers are hotlinked from covers.openlibrary.org.** They should be fetched
  once and served from our own storage, misses cached included, before any
  real traffic. That is M4.
- **Postgres 14 locally, 16 in CI and on RDS.** Nothing currently depends on
  15+ features, but the versions should be aligned.

## Milestones

| | | Status |
| --- | --- | --- |
| M1 | Ingest to sliced catalog | Done |
| M2 | Search and detail pages on `catalog.works` | Done |
| M3 | Users, shelves, ratings repointed at `work_key` | Done |
| M4 | Enrichment worker and covers | Next |
| M5 | Social layer, seeded rating graph | |
| M6 | Goodreads import against the catalog | |
