# Status — Life on Books

Where the project actually is, as of 2026-08-20. Written to be read by someone
deciding what to do next, so it leans on measurements rather than intentions.
Every number here was taken from the running system, not estimated.

Companion documents: `ARCHITECTURE.md` for how it works and why,
`DEPLOYMENT.md` for running it on AWS, `PRD.md` for what to build next.

---

## What it is

A reading tracker in the Goodreads mould — shelves, ratings, reviews, reading
progress, a social feed — plus two things Goodreads does not have: reader-
contributed **locations** (where a book is set, where an author lived) rendered
on a map, and **fictional world maps** for invented settings.

Next.js 16 App Router, React 19, TypeScript, Tailwind v4, NextAuth (JWT),
Prisma over Postgres.

## The shape that matters

Three Postgres schemas, and the separation is a licensing and lifecycle
control rather than tidiness:

```
catalog   rebuilt wholesale from Open Library dumps — nothing irreplaceable
app       user-owned, survives every ingest
seed      synthetic / restricted-licence, never served
```

**No foreign keys point from `app` into `catalog`.** A bad ingest must not
cascade into anyone's shelves. Write paths check a work exists; read paths
tolerate its absence and render "not in the current catalog" rather than
vanishing. This is the single most load-bearing decision in the schema.

---

## Built and working

| Milestone | What | Evidence |
|---|---|---|
| M1 | Ingest to a sliced catalog | 113.5M records staged, 0 quarantined |
| M2 | Search and work pages over `catalog.works` | 20 known books each in top 3 |
| M3 | Shelves, ratings, reviews on `work_key`; `app.books` retired | Server migrated; **client was not** — see below |
| M4 | Enrichment worker, cover storage | Worker runs; **no covers stored yet** |
| M5 | Social layer and rating graph | 100% coverage of top 1,000 works |
| M6 | Goodreads import with a review queue | Real export imports; unmatched queued |

### Live data

```
catalog   works 6,943,467   editions 8,885,863   authors 3,244,953
social    rated works 8,663   ratings 5,518,744   similarity pairs 173,156
derived   subject counts 875,472
database  11 GB
```

The catalog is the English-language, ISBN-bearing, cover-bearing slice from
1900 onward — 6.9M of Open Library's 41.5M works. Widening it is a change to
`config/slice.yaml` and a re-run, not a code change.

### Page surface

`/` `/search` `/work/[olKey]` `/author/[authorName]` `/my-books`
`/shelf/[shelfId]` `/user/[userId]` `/feed` `/map` `/settings` `/wrapped`
`/wrapped/projections` `/import/[sessionId]` `/about` `/login` `/register`

23 API routes. 18 migrations.

### Measured latency, against the real 6.9M-work catalog

| page | warm |
|---|---|
| `/work/[olKey]` | 0.07 s |
| `/search` (discover) | 0.08 s |
| `/search?subject=Fiction` | 0.10 s |
| `/search?q=dune` | 0.17 s |
| `/search?q=Fiction` | **4.2 s** — see limitations |

---

## Quality posture

362 tests: 124 unit, 238 integration. Integration runs against real Postgres
and must run serially — they share a database and truncate between tests.

Three habits are worth keeping, because each caught something a green suite
had missed:

**Mutation testing.** A test that cannot fail is worse than no test. Several
looked right and could not discriminate — a recommendation fixture where every
group member read every group book, so co-occurrence tied; a tab-escaping test
built on `JSON.stringify`, which escapes tabs itself. Both passed for the wrong
reason until a deliberate mutation exposed them.

**Asserting plans, not latency.** Every performance bug found at 6.9M works
passed 214 tests, and the p95-under-100ms test kept passing, because 4,000
fixture rows are fast to scan badly. `read-path-plans.test.ts` asks "does this
query read the whole table?" — the same answer at 3,000 rows as at 7 million.
Verified by reintroducing each real bug and watching exactly one test fail.

**Verifying against the running system.** Green tests and a green build have
missed a 500 (a `bigint` no test read but `JSON.stringify` refused), a
four-second search page, and a component wired to nothing.

### What the tests still do not catch

- **Reachability** — now partly covered. `core-loop.test.ts` asserts the work
  page mounts each component and that the routes accept exactly what those
  components send. Nothing generalises that check to other pages yet.
- **Anything visual.** No screenshot or DOM-level assertions. The dark-mode
  sweep was verified by grep and a build, not by looking.
- **Behaviour at catalog scale.** Deliberately: plan assertions replace it.

---

## The M3 repoint left the client behind

Worth its own section, because it was the largest defect found and it was
invisible to a green suite of 222 tests.

The repoint from `app.books` to `work_key` migrated the server layer and the
API routes, and left every client component on the old `bookId` contract.
`AddToShelfButton`, `ReadingProgressSection` and `ReviewForm` were mounted
nowhere at all; `ShelfSection` was mounted and called a route that had moved,
so removing a book from a shelf returned 404 and failed silently because the
handler only acted on `response.ok`.

The effect: **shelves and ratings could only be created by the Goodreads
importer.** A reader could search 6.9 million works and not shelve one.

All fixed, and covered by `core-loop.test.ts`. The reason it survived is worth
keeping in mind: all 222 integration tests called the server layer directly, so
every contract was verified and nothing noticed that no page called any of
them. `WorkLocationsSection` was the same failure in the same repoint, found a
day earlier.

## Known limitations

Ordered by how much they would hurt.

### Common-word search is slow — 4.2 s

"Fiction" matches 10,061 works and the ranked query reads every matching row.
The rank expression is *not* the cost: substituting a trivial
`ln(1 + edition_count)` still took 5.5 s. It is heap reads against a 3 GB table
with `shared_buffers` at **128 MB** — 213,848 blocks cold, 67 warm.

Two independent fixes: raise `shared_buffers` (needs a restart), and bound the
candidate set so ranking never reads more than N rows. The second is a decision
about result quality, not a patch.

### ~~A catalog rebuild takes the catalog offline~~ — fixed

Normalize builds into parallel `_new` tables and swaps them in at the end, so
the exclusive lock lasts for five drops and five renames rather than for the
rebuild. Demonstrated with an A/B: during a build-shaped transaction, reads of
`catalog.works` return and the table holds zero exclusive locks; during a
`TRUNCATE`-shaped one, the same read blocks until it times out.

Index names are the trap. `LIKE INCLUDING ALL` copies indexes but renames them
after the new table, and `ALTER TABLE RENAME` does not touch index names, so a
naive swap leaves the catalog disagreeing with its migrations for ever. The
swap renames them in a loop and raises if anything is left carrying the
temporary name.

The work-level filter also moved into normalize, before the swap. That was
worth doing for runtime — `cover_edition_key` and `author_names` now run over
the ~6.9M works that survive rather than all 41.5M, and `author_names` was the
longest statement in the first full run at six hours twenty.

**It does not remove the bloat.** That was the intuitive guess and it is wrong:
deleting from `works_new` leaves dead tuples in `works_new`, and renaming a
table does not compact it, so the dead space arrives under the new name.
Measured on a fixture — one live row, five dead, after the swap. A full rebuild
still wants a `VACUUM FULL`.

Removing it needs the non-qualifying works never to be inserted, which means
deciding the surviving work set from staging before works are built. Tracked as
R2b.

### The ingest takes about two and three quarter hours

Measured on a full rebuild of the 2026-07 dumps: **161m26s** for normalize,
against roughly nine hours before. Per statement, baseline then now:

| statement | before | after |
|---|---|---|
| works insert | 13m28s | ~8 min |
| work_authors | 38 min | ~3 min |
| editions | 64 min | ~33 min |
| author_names | 6h20m | ~60 min |

Four changes account for it: `ANALYZE` inside the transaction so the planner
stops sizing a 15M-row table at 1,269; the edition predicates applied during
the build rather than deleted afterwards; the work-level filter moved before the
expensive passes; and the secondary indexes dropped for the load and rebuilt at
the end. The last one was found by this run — an earlier ordering rebuilt them
too early and `cover_edition_key` doubled to thirty minutes as a result.

The rebuild is idempotent: it produced a catalog identical to the one it
replaced, and `prisma migrate diff` returns an empty migration afterwards. It
also corrected two stale `external_ids` rows that had accumulated because that
table was only ever inserted into, never rebuilt.

**Still costs a `VACUUM FULL`.** After the rebuild `catalog.works` holds
6,870,623 live tuples and 22,362,429 dead in a 13GB table; 3GB of that is real
data. Deleting 34M rows creates that bloat wherever it happens. See R2b.

### The old nine-hour figure, and what caused it

And left 34 GB of bloat needing `VACUUM FULL`. Four things dominated, all
measured: checkpoint pressure at the 1 GB `max_wal_size` default; an autovacuum
grinding a throwaway staging table for three hours; statistics four orders of
magnitude out *inside* the transaction (`catalog.authors` estimated at 1,269
rows while holding 15,380,614); and building ten edition rows for every one the
slice keeps. All four are fixed. The remaining cost is inherent to building
41.5M works to keep 6.9M — which the rebuild-and-swap change would also solve.

### Covers are 100% hotlinked

Every one of 8.9M editions has a cover id and `catalog.enrichment` is empty, so
every image loads from Open Library. M4 exists to stop that. Enriching 6.9M
works through a rate-limited API is not realistic; the sensible version is
enriching popular works and accepting hotlinks for the tail. That is a scope
decision, not a job to run.

### Recommendations cover 8,663 works of 6.9M

The graph is good where it exists — Dune's neighbours are Ender's Game,
Hitchhiker's Guide, Foundation, Dune Messiah — but goodbooks-10k only covers
~8.7K books. Everything else shows no rating and no neighbours. A larger corpus
is the only fix.

### Smaller, real

- **Rate limiting is per-process.** Correct for one long-lived instance; on
  serverless the effective limit becomes `limit × instances`.
- **Postgres 14 locally, 16 in CI and on RDS.** Nothing depends on 15+ yet.
- **`shared_buffers` 128 MB** on a machine with 64 GB.
- **ISBN logic exists twice**, SQL and TypeScript, guarded by a parity test.
- **`.env.local` points at an abandoned Neon database**, so `npm run dev` fails
  until it is deleted.

---

## Not built

- Deployment. `DEPLOYMENT.md` is written with real numbers behind it; nothing
  is provisioned. Needs RDS, S3 + CloudFront, EC2, `GOOGLE_BOOKS_API_KEY`,
  `S3_BUCKET`. Note `next build` will OOM on a t3.micro — build in CI.
- Cover storage at scale (above).
- Rebuild-and-swap ingest (above).
- Bounded-candidate search (above).

---

## Lessons the code now encodes

Written down because each cost hours and each is invisible in a diff.

1. **Anything the schema can declare, declare there.** Three GIN indexes were
   hand-written into a migration; the next `prisma migrate diff` generated a
   `DROP` for them and search ran unindexed for three milestones without a
   single failure.
2. **A function of a column cannot use that column's index.** Search compared
   `unaccent(lower(title))` against a trigram index on `title`. Correct
   results, sequential scan, no error. `unaccent` is `STABLE`, so an expression
   index is illegal too — hence the trigger-maintained `*_norm` columns.
3. **An identifier that has been through a spreadsheet is not the identifier.**
   goodbooks-10k's `isbn13` is scientific notation, rounded in the twelfth
   digit; rebuilt values disagreed with `isbn10` on 1,199 of 2,680 rows. Its
   `isbn10` lost leading zeros. Taking both at face value cost 6,481 of 9,300
   books.
4. **Statistics do not update inside a transaction.** Every statement after a
   bulk insert plans against the table as it was before.
5. **A check that passes because there is no data is not a pass.** The
   pre-flight reported all-clear on editions while `stage_editions` was empty.
6. **Length is not integrity.** A resumed download finished at exactly the
   advertised byte count and was corrupt.
