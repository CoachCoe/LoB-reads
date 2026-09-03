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

## Schemas

Three, and the separation is a licensing and lifecycle control rather than an
aesthetic one.

```
catalog   rebuilt wholesale from dumps every month — nothing irreplaceable
app       user-owned, survives every ingest
seed      synthetic / restricted-licence, never served RAW (added at M5;
          aggregates derived from it are served, with attribution — PRD §5)
```

Two rules follow from that first line:

1. **Nothing in `app` may hold a foreign key into `catalog`.** A bad ingest
   would cascade into user data. Work keys are plain text columns, validated at
   the application layer.
2. **User-contributed data about a work must be a join table in `app`**, never
   a column on `catalog.works` — a rebuild would erase it. This is why
   third-party enrichment sits in `catalog.enrichment` rather than on the work,
   and why fictional-world associations live in `app.work_fictional_worlds`.

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
B, subtitle C — subjects were deliberately removed; see "Subjects are a browse,
not a search"), with trigram similarity carrying typos that FTS
cannot match at all.

**Three statements, tried in order — not one query with an `OR`.** That was the
R1 fix and the ordering is the whole of it:

1. **Full text** (`search_vector @@ tsq`). Answers almost everything, and
   ranking is cheap: all 10,120 matches for "Fiction" cost 57 ms.
2. **Exact title** (`title_norm = norm`), when the query is entirely English
   stopwords so the tsquery is empty. "It", "Us" and "She" are real titles and
   the full-text arm cannot see them at all.
3. **Fuzzy** (`title_norm % norm`), only when full text found nothing — which
   is what a typo looks like. "mockingbrd" reaches "Mockingbird" here and
   nowhere else.

The two trigram arms are the expensive ones and are bounded by a 700 ms
`statement_timeout`, because their cost depends on how common the query's
trigrams are and that cannot be known before running: the same statement is
58 ms for "mockingbrd" and 5.5 s for "thexx". Union rather than fallback is what
made common words slow — `?q=the` pulled 1,933,084 candidate rows through the
heap to keep 2,111 of them, 18.5 seconds of the 19.

Ranking is not `ts_rank` alone. Relevance scoring puts "Dune Messiah" level
with "Dune" for the query *dune*, so exact-title and prefix matches carry most
of the weight and relevance only breaks ties. Edition count contributes a
logarithmic nudge, never enough to let a sequel outrank the original.

Accents are folded on both sides, or "Miserables" misses "Les Misérables"
silently. The stored side is folded at write time by the trigger on
`catalog.works`, which maintains `search_vector` and two normalized columns,
`title_norm` and `author_names_norm`; the query side folds user input with
`unaccent()`.

Those normalized columns exist so the trigram indexes are reachable. Comparing
`unaccent(lower(title))` against the query is equivalent in meaning but not to
the planner — a function of a column cannot use that column's index, and
`unaccent()` is `STABLE` rather than `IMMUTABLE`, so an expression index is not
allowed either. Postgres reports nothing: results stay correct and every fuzzy
lookup becomes a sequential scan. Comparisons therefore go against the `_norm`
columns, and `__tests__/integration/search-indexes.test.ts` asserts the query
plan rather than the results, with the wrapped form kept as a negative control.

Two related failures are worth remembering, because they share a cause —
database objects that Prisma does not know about. `prisma migrate diff`
generates a `DROP` for any index in the database but absent from
`schema.prisma`, which is how these three GIN indexes disappeared during M3;
and a hand-edit to an applied migration once removed the import tables from the
history entirely, so only the already-migrated development database still had
them. Anything the schema can declare is declared there, and a fresh database
built from migrations is checked against the datamodel rather than assumed.

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

## Enrichment

Open Library's descriptions are missing or one-line on most records. A
queue-driven worker fills them from Google Books.

**Nothing in a request path ever calls a third party.** Serving a work with no
description performs one INSERT with an ON CONFLICT and returns; the worker
picks it up out of band. This is enforced by a test that replaces `fetch` with
a throw and exercises the page's data path — note it re-implements that path
rather than importing the page module, so an inline `fetch` added to the page
itself would not fail it (recorded as SPEC-10 in the 2026-08-31 audit). It is easy to satisfy today and easy to break
later with "just fetch it inline when it's missing", which works locally and
inherits someone else's latency and downtime in production.

Results go to `catalog.enrichment` and never to `catalog.works`. That keeps the
monthly rebuild authoritative and makes purging a source one DELETE. Every row
carries an expiry, because the content is cached under someone else's licence
rather than owned — and the UI attributes it.

Confirmed absences are cached too. A large share of books genuinely have no
description anywhere, and re-asking forever is how access gets revoked.

    npm run enrich:backfill   # queue the works most likely to be read
    npm run enrich:worker     # drain the queue
    npm run enrich:covers     # fetch cover images into object storage

Google Books needs `GOOGLE_BOOKS_API_KEY`. Keyless requests are answered with
429 from any shared address — verified against the live endpoint — so without
one the worker backs off immediately and makes no progress.

### Covers

Fetched once and stored in our own object storage rather than hotlinked. Two
traps, both verified live:

- **A missing cover does not 404.** It answers HTTP 200 with a 43-byte 1×1
  transparent GIF, so `response.ok` is true and naive code stores it as a book
  cover. `?default=false` gives a real 404. There is a byte-length floor as a
  second line of defence.
- **Misses must be cached.** Many editions have no cover; re-requesting them
  forever is what gets an address blocked.

## Recommendations and the ratings graph

"Readers also enjoyed" is item-item collaborative filtering, precomputed into
`catalog.work_similarity`. The co-occurrence self-join behind it runs over the
whole ratings matrix and is not something to run while someone waits.

**Scored by cosine over co-raters, not raw co-occurrence.** Raw counts make the
most-rated books everyone's neighbour, so every list comes out identical and
useless. Dividing by `sqrt(raters_a * raters_b)` turns "many people read both"
into "people who read A disproportionately read B". A test asserts this: swap
the score for a raw count and it fails.

Recommendations need a ratings graph before the app has users, which is what
the `seed` schema is for.

    npm run social:load -- --synthetic   # generated graph, no download
    npm run social:load -- --download    # goodbooks-10k, ~100MB
    ENABLE_SEED_DATA=true npm run social:compute

### seed, and why it is a schema

`seed.users` and `seed.ratings` hold synthetic and externally-licensed data.
The separation is at schema level rather than a boolean column so that purging
is one TRUNCATE, and so "is this ours to serve?" is answerable from the table
name.

`ENABLE_SEED_DATA` defaults to **false**. Without it only real reviews count,
which on a new install means near-empty recommendations — correct, and better
than presenting a borrowed corpus as your community's opinion.

goodbooks-10k is **CC BY-SA 4.0** (this resolves an open question the data-layer
spec left as "assume local-only"). Redistribution is permitted with attribution,
unlike the UCSD Book Graph, which is academic-use-only. But ShareAlike is viral:
anything derived from it and then distributed inherits the licence. Keeping it
behind the flag and out of served responses means that question never has to be
answered. Raw files are gitignored.

## The catalog rebuild does not take the catalog offline

It used to. `03-normalize.sql` opened with `TRUNCATE catalog.works,
catalog.editions, catalog.work_authors, catalog.authors CASCADE` and rebuilt
inside the same transaction. `TRUNCATE` takes `ACCESS EXCLUSIVE` and holds it
until commit, so for the whole run **every read of those tables blocked** —
search, work pages, shelf hydration, the lot. Measured, not inferred: during the
first full ingest a bare `SELECT pg_relation_size('catalog.works')` sat waiting
on a relation lock the normalize transaction had held for over three hours. With
a monthly rebuild that is a multi-hour outage every month.

Normalize now builds beside the live tables rather than through them: into
`authors_new`, `works_new`, `editions_new` and so on, swapped at the end by five
drops and five renames, so the exclusive lock lasts milliseconds. Demonstrated
with an A/B against a `TRUNCATE`-shaped transaction — reads of `catalog.works`
return during a build-shaped one and the table holds zero exclusive locks.

Index names are the trap. `LIKE INCLUDING ALL` copies indexes but names them
after the new table, and `ALTER TABLE RENAME` does not touch index names, so a
naive swap would leave the catalog disagreeing with its migrations for ever. The
swap renames them in a loop and raises if anything still carries a temporary
name.

It does **not** remove the bloat — deleting from `works_new` leaves the dead
tuples in `works_new`, and renaming a table does not compact it, so the dead
space simply arrives under the new name. That is tracked as R2b in `PRD.md`; see
`STATUS.md` for the measurements.

## Ingest performance, and what the first full run cost

Numbers from the 2026-08 dump on a 64GB machine, recorded because none of this
was knowable from the fixtures and two of the three findings were mistakes of
mine.

Staging is fast and predictable: 113.5 million records through COPY at roughly
100k rows/sec, nothing quarantined, ~102GB of UNLOGGED staging tables.

Normalize is where the time goes, and four separate things dominated it in
turn:

1. **Checkpoints.** At the 1GB `max_wal_size` default the works insert spent
   its time in `IO/WALWrite` behind 562 requested checkpoints. Raising it to
   24GB moved the wait off WAL entirely.
2. **Autovacuum on staging.** A three-hour autovacuum ground `stage_editions`
   while normalize needed the same disk. Now disabled by migration; the tables
   are written once and dropped.
3. **Stale statistics.** Nothing updates statistics inside a transaction, so
   every statement planned against the catalog as it was before the TRUNCATE —
   `catalog.authors` estimated at 1,269 rows when it held 15,380,614. The
   `work_authors` insert ran over four hours; with `ANALYZE` after each bulk
   insert it takes 38 minutes.
4. **Building rows only to delete them.** The slice keeps 10.1% of editions, so
   inserting all 56.6 million and letting `04-slice.sql` remove 51 million
   meant writing ten rows for every one kept. The edition predicates now run
   in normalize as well; 9.05M editions are built instead of 56.6M.

Slice leaves the catalog badly bloated, and nothing reclaims it. Building
41.5M works to keep 6.9M means `catalog.works` ends the run at 39GB holding
7.1 million live tuples and 37.8 million dead ones — 84% dead space.
`05-index.sql` runs ANALYZE, truncates the staging tables and rebuilds
`catalog.subject_counts`, but reclaims no space; VACUUM
reclaims it for reuse but does not shrink the files. Only VACUUM FULL, or
building the table filtered in the first place, actually recovers it.

That is the same waste as the editions filter, one step later, and it is the
strongest argument for the rebuild-and-swap pattern described above: normalize
into filtered tables and swap them in, rather than building everything and
deleting most of it. It would remove the bloat, the hours spent writing rows
that get deleted, and the multi-hour exclusive lock, all at once.

One change of mine backfired. Disabling the `search_vector` trigger during the
works insert did halve that statement — but it left the three GIN indexes
empty, so the later `author_names` update had to build every GIN entry at once
across 39 million rows while generating a dead tuple for each. That update
became the longest statement in the run. The fix was the standard one for bulk
loading, and it is what `03-normalize.sql` now does: drop the secondary indexes
before the load and rebuild them at the end, rather than moving when they are
maintained.

`auto_explain` is loaded inside the normalize transaction for this reason. A
slow statement here cannot be EXPLAINed from another session and every table it
touches is locked, so without it the only evidence is wait events — which is
how hours went into guessing at a plan that the log would have shown outright.

## What the real catalog broke

Every one of these was invisible on the 5,030-work fixture and appeared the
moment the catalog held 6.9 million works. All measured, all on the search page.

| | before | after |
|---|---|---|
| `getCatalogSubjects` | 3,944 ms | 0.17 ms (precomputed) |
| `getPopularWorks` | 1,976 ms | 0.31 ms (index) |
| trigram threshold | 223 ms | 40 ms (0.3 → 0.5) |
| `countWorkMatches` ("Fiction") | 5,481 ms | 49 ms (ceiling) |
| search page, "dune" | 3.6 s | 0.17 s |
| search page, "Fiction" | 110 s | 6.7 s |
| query, "Fiction" (R1) | 1,065 ms | 31 ms (arms split) |
| query, "the" (R1) | 19,189 ms | 1 ms (arms split) |

Two of them were the same mistake in different clothes: a query that aggregates
or sorts the whole table to produce a handful of rows. `getCatalogSubjects`
unnested every work's subjects on every request — and the search page paid for
it too, then discarded the result, because the subject chips only render when
there is no query. The original audit had already caught this in its earlier
form ("getAllGenres reads the entire books table into memory on every
search-page render"); it was rewritten as a GROUP BY, which is not the same as
making it cheap.

Subjects are no longer searched. As the D-weighted term in `search_vector`
they made every generic word match most of the catalog, and the discover page's
own chips linked straight into the worst case:

|          | in search_vector | excluded |
|---|---|---|
| "Fiction" | 735,956 | 10,061 |
| "History" | 629,451 | 80,563 |
| "dune"    | 456 | 416 |

A title or author search — what people actually type — barely moves. Subjects
are indexed for containment instead, so a chip is a browse:
`/search?subject=Fiction` answers in 0.031s with an exact count from
`subject_counts`, against 110 seconds before.

This diagnosis was wrong and is kept only because it was acted on: the
paragraph here used to blame `shared_buffers` at 128MB for a 4.2s `Fiction`
query and conclude that the fix "belongs with the deployment settings rather
than in a migration". The real cause was a lossy bitmap at the 4MB `work_mem`
default — see STATUS.md's "what the numbers actually showed" — the page is
1.23s after raising it, `shared_buffers` at 3GB leaves it at 1.2s, and the
setting *does* travel in a migration
(`20260821120000_work_mem_for_bitmap_scans`), asserted by `deploy:verify`.

**The older note below is kept because the reasoning still holds for any large
match set.** "Fiction" matches 735,956
works, because subjects are searchable. Ranking them requires reading every
matching row: the rank expression is not the cost — substituting a trivial
`ln(1 + edition_count)` still took 5,481 ms — the heap reads are. So no
adjustment to the weights will help, and the search page's own subject chips
link straight into this case.

The fix is a bounded candidate set: rank an approximate top-N rather than the
whole match set, which is a decision about result quality and not a patch.
A subject chip would be better served by an indexed `subjects @> ARRAY[...]`
lookup than by full-text search. That is what the code now does — see
"Subjects are a browse, not a search" above; `works_subjects_idx` exists, is
declared in `schema.prisma`, and `deploy:verify` asserts it.

## The ratings graph, and a corpus that lies about its ISBNs

`scripts/social/load-ratings.ts` loads goodbooks-10k (CC-BY-SA) into `seed`.
With the real catalog it matches 8,692 of 9,300 books (93.5%) and keeps
5,518,739 of 5,976,479 ratings across 53,424 readers, which gives 173,156
similarity pairs and covers 100% of the top 1,000 works — the M5 acceptance,
met with real data rather than a fixture.

It matched a third of that until the corpus's ISBN columns were looked at.
Both were written by something that coerced them to numbers:

- **`isbn13` is scientific notation** — `9.78043902348e+12`. Not merely missing
  its check digit: the twelfth digit is rounded too. Rebuilding the value and
  cross-checking against `isbn10` disagreed on 1,199 of 2,680 rows, so it is
  unrecoverable and deliberately ignored.
- **`isbn10` lost its leading zeros.** Of 9,300 values, 5,573 are nine
  characters, 916 are eight, 112 are seven. An ISBN-10 is exactly ten, so
  padding restores it. The padding is *not* validated: `isbn10To13` discards
  the ISBN-10 check digit, so a corrupted value yields a well-formed ISBN-13
  rather than a rejection. What protects the match is that the ISBN-13 must
  exist in `catalog.editions` — a wrong guess loses a rating rather than
  attaching it to the wrong book.

Taking the columns at face value cost 6,481 of 9,300 books and three quarters
of the ratings. Worth remembering for any corpus that arrives as CSV: an
identifier that has been through a spreadsheet is not the identifier.

## Known limitations

- **Rate limiting is per-process** (`src/lib/rate-limit.ts`). Correct for a
  single long-lived instance; on serverless the effective limit becomes
  `limit × instances`. The interface is storage-agnostic so swapping in a
  shared store is one file.
- **Dump downloads are resumable, and a resume is only as good as its
  provenance.** `acquire` writes a `.meta.json` sidecar recording the etag,
  last-modified and length a partial belongs to, and refuses to resume onto
  bytes it cannot tie to the object the server is currently offering. It also
  persists after completion as the record that the archive was checked, so a
  complete-but-unverified file is decompressed rather than skipped on faith.
  This exists because the first real download finished at exactly the
  advertised length and was corrupt: it had resumed onto 11KB from an earlier
  failure. Open Library republishes monthly, so a stale partial is routine.
- **Covers fall back to hotlinking** for anything `enrich:covers` has not
  reached yet, so a fresh catalog still shows images before the first backfill.
- **ISBN logic exists twice**, as SQL for the ingest and TypeScript for the
  corpus loader, which reads a CSV in Node. `isbn-parity.test.ts` asserts the
  two agree, so changing one without the other fails loudly.
- **Timestamps are `timestamptz`.** Prisma's default `DateTime` maps to
  `timestamp without time zone`; Prisma then writes UTC while SQL `now()`
  returns local time, so comparisons between them are wrong by the server's
  offset. Guarded by a test asserting no naive timestamp columns exist. Keep
  `@db.Timestamptz(6)` on new DateTime fields.
- **Postgres 14 locally, 16 in CI and in the container topology.** Nothing currently depends on
  15+ features, but the versions should be aligned.

## Import

`src/server/imports.ts`. A Goodreads export becomes a session with a row per
line, persisted before anything is applied.

Rows matching by ISBN or exact title and author are applied straight away;
asking someone to confirm 640 certain matches is data entry, not review.
Everything else is kept with its trigram candidates and waits at
`/import/[sessionId]`. A fuzzy match is never applied on its own however well
it scores — "The Hobbit" and "The Hobbits" are one edit apart and different
books.

The reported match rate deliberately counts only automatic matches. Folding in
confirmations would measure the reader's patience rather than the catalog's
coverage, and would reach 100% for any import someone finished.

## Milestones

| | | Status |
| --- | --- | --- |
| M1 | Ingest to sliced catalog | Done |
| M2 | Search and detail pages on `catalog.works` | Done |
| M3 | Users, shelves, ratings repointed at `work_key` | Done |
| M4 | Enrichment worker and covers | Worker done; covers **not** served — `coverUrl`'s `storedUrl` argument has no caller, so `enrich:covers` stores objects nothing reads. See PRD R4. |
| M5 | Social layer, seeded rating graph | Done |
| M6 | Goodreads import against the catalog | Done |
