# Status — Life on Books

Where the project actually is, as of 2026-08-31. Written to be read by someone
deciding what to do next, so it leans on measurements rather than intentions.
Every number here was taken from the running system, not estimated.

Companion documents: `ARCHITECTURE.md` for how it works and why,
`DEPLOYMENT.md` for running it on Azure, `PRD.md` for what to build next.

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
seed      synthetic / restricted-licence, never served RAW (see PRD §5:
          aggregates computed from it are served, with attribution)
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

23 API routes (including liveness and readiness probes). 21 migrations.

### Measured latency, against the real 6.9M-work catalog

| page | production | dev |
|---|---|---|
| `/` | 0.009 s | 0.07 s |
| `/search` (discover) | 0.008 s | 0.08 s |
| `/work/[olKey]` | 0.009 s | 0.07 s |
| `/search?subject=Fiction` | 0.031 s | 0.10 s |
| `/search?q=dune` | 0.091 s | 0.17 s |
| `/search?q=Fiction` | **1.23 s** | 4.2 s — see limitations |

A production build is five to ten times faster everywhere except the common-word
search, which barely moved (4.2 s to 3.5 s). That asymmetry is what ruled out
rendering overhead and sent the investigation to the query plan, where the real
cause turned out to be a lossy bitmap. 1.23 s is that query after raising
`work_mem`; see limitations for why it is not yet under a second.

---

## Quality posture

498 tests: 202 unit, 296 integration. Integration runs against real Postgres
and must run serially — they share a database and truncate between tests.

The 2026-08-31 audit added 127 of those, and the reason is worth stating plainly:
all five checks were green — typecheck, lint, 128 unit, 243 integration, build —
while four blockers sat in the tree, including a page that threw on load. A green
suite here has repeatedly meant "the tests that exist pass", not "the app works".
See `docs/audit/2026-08-31-findings.md`.

Two things about that database were wrong until recently. `test:all` ran the
integration project in parallel, so it could never have passed — the two suites
had only ever been run separately. And the test database had 29 tables and **no
`_prisma_migrations`**: it had been created with `db push`, never from the
migration chain, so `db:deploy:test` failed with P3005 and local integration
tests validated a schema the migrations do not necessarily produce. Only CI,
which starts from an empty database, would have caught the divergence. Both are
fixed; the test database is now built from migrations exactly as CI builds it.

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

- **Reachability** — largely covered now, mechanically and for every component
  rather than one page. `conventions.test.ts` asserts that every `/api/...`
  literal in the source resolves to a route directory and that every method a
  fetch names is exported by it — so the M3 defect (components left calling
  routes that had moved) fails the suite rather than 404ing silently for three
  milestones. It also forbids a client component value-importing `src/server/*`
  or `@/lib/prisma`, which is the shape that produced the /my-books blocker.
  `core-loop.test.ts` still hand-types its request BODIES, so field-name drift
  in a body is not covered; and nothing yet asserts that a given page mounts a
  given component beyond the work page. The audit found five "built, wired to
  nothing" cases that remain — see the work-completed doc.
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

### Common-word search is slow — and the earlier diagnosis was wrong

"Fiction" matches 10,061 works. The rank expression is not the cost —
substituting a trivial `ln(1 + edition_count)` still took 5.5 s — and this was
previously attributed to heap reads against a 3 GB table with `shared_buffers`
at 128 MB. Reading the plan shows something more specific and much cheaper to
fix.

At the 4 MB `work_mem` default the bitmap index scan **overflows and goes
lossy**: it can no longer track individual rows, so it degrades to page
granularity and rechecks every row on every candidate page. Raising `work_mem`
alone, with `shared_buffers` untouched at 128 MB:

| `work_mem` | rows rechecked | heap blocks | query |
|---|---|---|---|
| 4 MB | 1,028,773 | 11,357 exact + **55,531 lossy** | 3549 ms |
| 32 MB | 93,941 | 67,069 exact, none lossy | **1007 ms** |
| 256 MB | 93,941 | 66,682 exact | 926 ms |

A 3.5× speed-up from one setting, and 32 MB is the knee — more buys almost
nothing. On the page: **3.5 s → 1.23 s**.

**Caching cannot finish the job.** With `shared_buffers` at 3 GB the query
reports `shared hit=202478, read=0` — the entire working set is resident, zero
disk reads — and still takes 1.2 s. Whatever remains is CPU: rechecking 93,941
rows and ranking 10,061 of them.

So the ordering is now clear. Raise `work_mem` for the immediate 3.5×; bounding
the candidate set (R1) is still required to get under a second, and no amount of
memory substitutes for it.

`work_mem` now travels in a migration (`ALTER DATABASE … SET work_mem`) rather
than being set by hand on one machine, which is how a fresh clone used to get
the slow query back silently. If a managed provider refuses `ALTER DATABASE`,
the migration raises a warning and `npm run deploy:verify` fails on it — warned
at migrate time, caught at deploy time.

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

- **Rate limiting is per-process**, so it does not hold across replicas.
  Correct for one long-lived instance; on serverless, or on Container Apps with
  more than one replica, the effective limit becomes `limit × instances`.
- **Postgres 14 locally, 16 in CI and in the container topology.** Nothing
  depends on 15+ yet, and the full migration set now applies cleanly to 16.
- **`shared_buffers` 128 MB** on a machine with 64 GB. Worth raising, but it is
  not the search bottleneck it was assumed to be — see above.
- **ISBN logic exists twice**, SQL and TypeScript. The parity test now compares
  the two implementations of the same thing — `is_valid_isbn13(clean_isbn(x))`,
  the form the pipeline actually uses — and pins the deliberate contract
  difference. It previously compared unlike things and its case list contained no
  separator-bearing ISBN-13, so the boundary agreed by accident.
- ~~**`enrichment.test.ts` has a narrow timing dependency.**~~ Fixed. The
  mechanism was confirmed from source, not just arithmetic: the first backoff is
  `30 × (0.5 + random())`, and `0.5 + random()` spans [0.5, 1.5), so the range is
  **15–45 s** — not 15–30, which is what a first attempt at pinning it assumed
  before the suite disproved it. Computed from the **Node** clock, while
  `claimJobs` compares against Postgres `now()`, so the margin was 15 s at worst
  plus any app↔DB clock skew. The test now passes an explicit 3600-second
  backoff, and the jitter it used to depend on is asserted separately without
  racing it.
- ~~**`reclaimStale` has a wrong predicate, and no test.**~~ Fixed. It measured
  from `created_at` — when the job was *enqueued* — so on a real queue a freshly
  claimed batch was handed to a second worker. A migration added `claimed_at`,
  set in the same UPDATE that claims the row, and two tests now fail against the
  old predicate.

---

## Not built

- **Deployment itself.** Nothing is provisioned. What *is* done: the app is
  containerised, the topology runs locally under Docker Compose, storage is on
  Azure Blob, and `DEPLOYMENT.md` is rewritten for Azure with measured numbers.
  What is left is an Azure subscription, a Flexible Server, a storage account
  and `GOOGLE_BOOKS_API_KEY`. See below.
- Cover storage at scale (above).
- Bounded-candidate search (above).
- Instrumentation. Every performance problem so far was found by hand.

## Deployment readiness

Rehearsed locally rather than assumed. `docker-compose.yml` runs Postgres 16,
PgBouncer in transaction mode, the app container and Azurite, because each of
those differs from `npm run dev` in a way that has hidden a real failure.

| | |
|---|---|
| image | 479 MB, `output: "standalone"`, Debian, unprivileged |
| `next build` | 5.4 s, ~2 GB peak — more than a burstable instance has, so CI builds it |
| migrations | all 19 apply to an empty Postgres 16 |
| catalog dump | **103 s**, 1.7 GB compressed from 10 GB |
| storage | 11/11 checks against a real blob endpoint, both private and public postures |
| probes | liveness stays 200 with the database stopped; readiness returns 503 in 2.0 s |
| release check | `npm run deploy:verify` — 21 assertions over config and schema (23 with distinct pooled/direct URLs), 29 with a running app |

The pooled-versus-direct connection split had never been exercised — local
development points both variables at the same string. Under PgBouncer in
transaction mode, reads, a nested-transaction registration and 30 rapid
concurrent requests all pass.

Two probes rather than one, because the distinction matters: liveness must not
depend on the database, or a brief Postgres blip becomes a restart loop across
every replica. Verified by stopping Postgres — liveness answered 200 in 4 ms
while readiness returned 503 — and by confirming the app recovered on its own
when Postgres came back, with no restart.

The first version of the readiness probe **hung** instead of failing: with
Postgres stopped the query blocked on connect for longer than 25 s, so the probe
returned nothing at all. An unanswered probe is worse than a failing one,
because to an orchestrator it looks the same as a wedged process. It now has a
2 s budget.

**The rehearsal earned its cost immediately.** The first container built
cleanly, started cleanly, served static pages, and returned 500 on every page
that touched the database: Prisma 5.22 probes the host to choose a query engine
and resolves `openssl-1.1.x` on current Alpine, which ships only
`libssl.so.3`. No test could have caught it and the build reported success.

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
7. **A green build is not a working container.** Prisma picks its query engine
   by probing the host, so the same image that builds and starts cleanly can
   fail on every query. Anything resolved at runtime by detection has to be
   exercised at runtime, on the target platform.
8. **A test script that cannot pass is not a test script.** `test:all` ran the
   integration project in parallel, and those tests share one database and
   truncate between tests. It could never have gone green, and nothing noticed
   because the two suites were always run separately.
9. **A lossy bitmap is invisible unless you read the plan.** The common-word
   search was diagnosed twice from timings and buffer counts, and both times the
   conclusion was "too little cache". `EXPLAIN (ANALYZE, BUFFERS)` named it in
   one line: `Heap Blocks: lossy=55531`. Latency tells you something is slow;
   only the plan tells you what.
10. **"Configured" has to mean "will actually work."** Storage with credentials
   but no CDN in front of a private container accepted every upload and served
   403 for every image. `isStorageConfigured()` now requires something that can
   serve the bytes, so a missing setting disables uploads instead of silently
   producing broken pictures.
