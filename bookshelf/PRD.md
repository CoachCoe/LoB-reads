# PRD — Life on Books

What to build next, and why. Deliberately short. `STATUS.md` has the evidence
for every claim of fact here.

> **Open input needed.** Bhavia's requirements are not recorded anywhere in this
> repository — not in a document, not anywhere in its history. The priorities
> below are derived from measured defects and known gaps, which is a different
> and weaker basis than knowing what a stakeholder actually asked for. **They
> should be re-ordered once Bhavia's requirements are supplied**, and P0 in
> particular is likely to change.

---

## 1. What this product is

A reading tracker for people who want to keep a library, not just a list:
shelves, ratings, reviews, progress, and what the people they follow are
reading. Its two distinguishing features are geographic — reader-contributed
**locations** (where a book is set, where its author lived) on a map, and
**maps of fictional worlds** for invented settings.

The bet is that "where" is an under-served way into a library. Everything else
is table stakes that has to be good enough not to get in the way.

## 2. Who it is for

- **The reader keeping a library.** Wants their Goodreads export in, wants to
  find a book in one search, wants to see what they read this year.
- **The contributor.** Adds locations and world maps. Editing is wiki-style —
  anyone signed in may edit, uploader-or-moderator may delete — because the
  data only exists if contributing is easy.
- **The browser.** Arrives with no account, follows a subject or an author.
  Must never hit a login wall to look at a book or a public shelf.

## 3. Where it stands

Six milestones are built: ingest, search, shelves on `work_key`, an enrichment
worker, the social layer, and Goodreads import with a review queue. A 6.9
million-work catalog is loaded, 11 GB, with 5.5M ratings behind
recommendations. The test count lives in `STATUS.md`, which is where the
evidence for every claim of fact here is meant to live — this line carried its
own number and drifted to 627 while STATUS said 665 and the suite ran 710.

The gaps are not features that were forgotten; they are the consequences of
running at real scale for the first time. See `STATUS.md`.

---

## 4. Requirements, by priority

### P0 — the product is visibly broken without these

**R0. ~~The reading loop must be reachable.~~ Done.**
Shelving, rating, reviewing and progress tracking had no UI path: the M3
repoint migrated the server and left the client on the old `bookId` contract,
so shelves and ratings could only come from the Goodreads importer. Fixed and
covered by `core-loop.test.ts`. Kept here because it outranked everything below
and its absence made the rest academic.

**R1. ~~Search must answer in under a second for any query.~~ Done.**
Measured warm on the real 6.9M-work catalog, before and after:

| query | before | after |
|---|---|---|
| `the` | 19,189ms, 2,111 results | ~380ms, **0 results** — see below |
| `of the` | slow | ~380ms, **0 results** — see below |
| `the lord of the rings` | 2,013ms | 8ms |
| `Fiction` | 1,065ms | 43ms |
| `history` | 606ms | 360ms |
| `dune` | 90ms | 11ms |
| `the hobbitt` (typo) | 0 results | 20 results, ~630ms |

Twenty-two queries, all under a second. `npm run bench:search -- --gate` exits
non-zero and is run by hand against the real catalog — it is not in CI, because
it proves nothing on a fixture.

**Two corrections to what this table used to say**, both found by the
2026-09-08 audit and both worth keeping visible.

`the` was published here as **1ms**. That was the full-text arm measured in
isolation. A stopword-only query has an empty tsquery, so the full-text arm
matches nothing and the *exact-title* arm answers — and on the real catalog
that arm needs 1.8-2.1s for `the`, because `title_norm` carries a GIN trigram
index and no btree, so `title_norm = 'the'` cannot be an equality lookup. It is
therefore abandoned at its timeout and returns nothing. Six works are titled
exactly "the". So the arm built to rescue stopword titles cannot answer its two
most common members, and the 1ms figure had been copied into three documents as
if it were the whole search's latency.

`the hobbitt` was published as **565ms**, and 565ms is its p50, not its tail.
Measured n=15 it runs 602-801ms, and inside the full benchmark it has been seen
at 989ms — so at the old 700ms budget it returned 20 results or nothing
depending on the run, zero on 3 of 12 consecutive warm requests. The budget is
now 900ms, which reduces that rather than removing it; the cost is ~70,000 heap
block reads that cannot stay resident in a 128MB `shared_buffers`, and no
timeout fixes that. See `catalog.ts`, which carries the plan.

**Bounding the candidate set was the wrong fix, and it was never needed.** The
first attempt capped what reached the ranking expression and made `?q=dune` 500x
slower; the trap is recorded below because it is still a trap. But the premise
was wrong too: **ranking was never the cost.** Ranking all 10,061 matches for
"Fiction" takes 57ms.

The cost was the other arm of the `WHERE`. `title_norm % q.norm` is a trigram
similarity match, and for a query whose trigrams are common the GIN index cannot
be selective — `?q=the` returned **1,933,084 candidate rows**, every one fetched
from the heap (373,236 blocks, ~2.9GB against a 128MB `shared_buffers`) so that
`similarity()` could discard 1,926,798 and keep 2,111. That was 18.5 of the 19
seconds, and raising `pg_trgm.similarity_threshold` does not touch it: 0.3, 0.5
and 0.7 all return the same 1.9M candidates.

So the two arms are now separate statements, chosen in order rather than `OR`ed:

1. **full-text** — always tried first, and it answers almost everything.
2. **exact title** — when the query is entirely stopwords, so the tsquery is
   empty. This is not a micro-optimisation: "It", "Us" and "She" are real
   titles, and searching "It" returned nothing until this arm existed.
3. **fuzzy** — only when the full-text arm found nothing, which is what a typo
   looks like. "mockingbrd" finds "Mockingbird" through this arm and no other.

The fuzzy and exact-title arms are each bounded by their own
`statement_timeout` — **900ms** for fuzzy, **300ms** for exact-title — because
their cost is a function of trigram frequency and cannot be known before
running: the same statement is 35ms for "mockingbrd" and 6s for "thexx". It
fails safe: the reader gets no results rather than a wait.

The two budgets were one until the 2026-09-08 audit, and the arms have nothing
in common but a `SET LOCAL`. Every query the exact-title arm exists to rescue
answers inside 131ms ("us" 18ms, "she" 36ms, "it" 124ms), so 300ms clears them
twice over and stops the stopword path spending the fuzzy arm's whole budget to
return nothing.

"the queries it abandons were returning nothing anyway" was true of the
adversarial cases and **not** of `the hobbitt`, which is a real typo with 20
real matches. That is why `bench:search` now gates on a minimum row count per
query as well as the clock: an abandoned arm returns nothing *faster*, so the
clock alone read a broken search as an improvement.

**The trap from the reverted attempt, kept because it is still live:**
`ORDER BY edition_count DESC LIMIT 200` invites the planner to walk
`works_edition_count_ol_key_idx` in popularity order and filter as it goes,
betting it will fill the LIMIT early. `title_norm LIKE 'dune%'` matches 113 rows
in 6.9M, so it walked all 6,943,467 — 10.9s in one subquery. Every subquery was
fast in isolation (7-335ms); only the combination was slow.

**And it was not catchable by any test in this repo.** At 3,000 fixture rows the
planner correctly chooses bitmap scans; it only flips to the ordered walk when
the table is big enough. The reverted query was restored and every plan
assertion still passed. What is asserted instead is the statement's SHAPE — one
`LIMIT` per arm, and no trigram predicate in the full-text arm — which is a text
check and labelled as one. The clock lives in `bench:search`, against the real
catalog, because nothing smaller can see this class of regression.

*Done when:* ~~no query in a representative set exceeds 1 s warm measured on the
real catalog, and the bound is held by something that fails when it breaks.~~
Both hold, with one qualification added by the 2026-09-08 audit.
`bench:search --gate` is the clock AND now a recall floor per query; the shape
assertions are in `read-path-plans.test.ts` and assert the WHERE clause rather
than one spelling of one operator; and `deploy:verify` times one query per arm
and asserts each comes back with results.

The qualification: `deploy:verify`'s per-arm timings only run when `BASE_URL` is
set, and no workflow sets it, so that half has never run in automation. The gate
now reports the skip as a warning rather than a pass.
*~~Open question for you:~~ answered: approximate results for very common words
are acceptable — and the fallback ordering is how that was spent.*

### P1 — the product works but under-delivers

**R2b. Never insert the works the slice discards.**
Cited by `ARCHITECTURE.md`, `STATUS.md` and `DEPLOYMENT.md` as "tracked as R2b
in PRD.md", and until the 2026-09-08 audit it was tracked nowhere — this file
has no R2 and had no R2b, so three documents deferred the item to a requirement
that did not exist.

The ingest stages every work and then deletes the ones outside the slice, so the
table carries the dead rows until a `VACUUM FULL` reclaims them. The measured
figures differ by run and by pipeline stage, which is itself part of the problem:
`STATUS.md` records 6,870,623 live against 22,362,429 dead in 13 GB,
`ARCHITECTURE.md` records 7.1M live against 37.8M dead in 39 GB, and
`DEPLOYMENT.md` uses 134 GB before a `VACUUM FULL` to size storage. None says
which run it describes.
*Done when:* the slice predicate is applied on insert rather than by a later
delete, and one table of figures with one owner replaces the three.

**R3. Recommendations and ratings should cover more than 0.1% of the catalog.**
The machinery is right; the corpus is 8,663 works of 6.9M. Everything else
shows no rating and no neighbours. Needs a larger corpus, or real user
ratings, or both.
*Done when:* a reader landing on a mainstream book sees a rating and
neighbours more often than not.

**R4. Covers should not depend on Open Library staying up.**
All 8.9M are hotlinked. Enriching every work through a rate-limited API is not
realistic, so this is a scope decision: enrich the popular head, hotlink the
tail.
*Done when:* the works people actually open serve covers from our own storage.

**R5. Deploy it.** *Target is now Azure, not AWS.*
The app is containerised (479 MB), the topology is rehearsed locally under
Docker Compose, storage runs on Azure Blob (verified against Azurite), and
`DEPLOYMENT.md` is rewritten for Azure. The catalog dumps to **1.7 GB
compressed**; the catalog is 11 GB and the whole database 12 GB — the seed
corpus is the extra gigabyte — so it fits the smallest Flexible Server
allocation with room to spare.
There is also a release gate: `npm run deploy:verify` checks connection strings
are the right way round, extensions, migrations, `work_mem`, the four search
indexes, the search trigger, statistics, catalog contents, and the rate
limiter's assumptions — plus, when `BASE_URL` points at a running app, both
probes, the CSP's CDN origin and one timed query per search arm. It exits
non-zero, so it gates a release rather than being a checklist someone reads.
`DEPLOYMENT.md` owns the full list and the script prints its own totals; the
counts this paragraph used to give were wrong.
*Outstanding:* neither workflow sets `BASE_URL`, so the running-app checks have
never run in automation. The gate now reports that as a warning instead of a
pass, and fails on it when a deployment target is configured.
*Needs from you:* an Azure subscription, and `GOOGLE_BOOKS_API_KEY`.
*One thing to know:* ~~the common-word search will still be slow on a burstable
tier, because that is R1 and not a configuration problem.~~ R1 is closed, so
this no longer applies — but `bench:search` should be re-run against the
deployed catalog, because the 700ms fuzzy budget was calibrated on a machine
with `shared_buffers` at 128MB and a burstable tier may need a different one.

### P2 — worth doing, nothing waits on it

**R6. ~~Make the location features discoverable.~~ Largely done.** `/map` was
not merely buried — it was behind `redirect("/login")`, so a reader with no
account could not reach it at all. It is public now (audit OQ-4), and the navbar
renders Home, Discover, Map and About for signed-out visitors, who previously got
no navigation whatever and, on a phone, not even a search box. A conventions test
pins the public-page list so making one private is a visible choice.

What is left is placement rather than access: locations still appear only far
down work and author pages, and nothing on the home page points at the map.

**R7. Generalise the reachability check.** Partly done, and the remaining half
is now the one that matters.

`core-loop.test.ts` asserts the work page mounts its components, but only that
page. `conventions.test.ts` has since generalised three things beyond it: every
client `fetch` of an `/api/...` literal resolves to a route exporting that
method; every private page takes its session through `requireUser`; and no
component links a work title that carries a missing-work fallback. The last two
were added by the 2026-09-08 audit and each caught a real defect on its first
run.

What is left is the **reverse** direction, and it is the gap that let the
location edit path (R8) be built and never wired up: nothing asserts that every
mutating route handler is reached by some client call. A route method with no
caller passes every check in the repo. An allowlist is needed for the ones
legitimately called from elsewhere — `[...nextauth]` and the two health probes,
which `deploy:verify` calls.

Also still true: only the work page has a mount assertion. A component sweep
during the 2026-09-08 audit found exactly one orphan (`ui/Badge.tsx`), so that
half would catch one thing today, against the route half's one blocker.

**R8. Housekeeping.** Move rate limiting to a shared store before scaling past
one replica — Container Apps scales by default, which makes the effective limit
`limit × replicas`. The in-process limiter is at least sound now: it was
quadratic past 10,000 keys and keyed on the client-controlled end of
`X-Forwarded-For`, both fixed in the 2026-08-31 audit.

Also open from that audit, and not housekeeping: `/my-books` was shipping Prisma
to the browser and never hydrated (fixed), and CI's release gate could never
pass (fixed). ~~Two documented features — custom shelves and creating a
fictional world — have working API routes with no UI to reach them.~~ Both are
now reachable: `my-books/CustomShelves.tsx` creates and deletes shelves, and
`map/FictionalWorldsPanel.tsx` creates a world on the now-public `/map`.

**The successor to that class of bug is the location EDIT path**, found by the
2026-09-08 audit and still open. PRD §2's "anyone signed in may edit" is built
end to end below the UI — `PATCH` on both location routes, both server
functions, both schemas, and the `location_updated_by` migration — and nothing
calls it. Verified working by driving the routes directly: a second account's
edit is accepted and recorded in `updated_by_id`, and its delete is refused.
There is simply no control. `updated_by_id` is also written and read by nothing,
so an edit is currently invisible and unattributable on a public page.
*Done when:* an edit control exists on a location row, and
`conventions.test.ts` asserts the reverse direction — every mutating route
handler is named by some client call — which is R7's remaining half and is what
would have caught this mechanically.

See `../docs/audit/2026-08-31-work-completed.md` for what was deferred and why,
and `../docs/audit/2026-09-08-findings.md` for the round that found the above. `.env.local`
is deleted and `npm run dev` works; `work_mem` now travels in a migration
instead of being set by hand; the test database is built from the migration
chain rather than `db push`; and all 26 migrations apply cleanly to Postgres 16,
which local development still does not run.

---

## 5. Explicitly not doing

- **Widening the catalog beyond the English 1900+ ISBN slice.** 6.9M works is
  not the constraint on this product; discovery is.
- **Filtering the catalog to the rating corpus.** Implemented and left off: it
  would cut 6.9M works to 8,659. Its original purpose was fitting the AWS free
  tier, and the full catalog is 11 GB against a 20 GB limit.
- **Redistributing the seed corpus.** `seed` is CC-BY-SA and ShareAlike is
  viral, so the corpus itself is never served or exported.

  This bullet used to say "nothing derived from it is served", and that was
  false: `ENABLE_SEED_DATA` gates whether `compute-stats` folds `seed.ratings`
  into its input, but the aggregates it writes land in `catalog.work_rating_stats`
  and `catalog.work_similarity`, which the work page reads with no flag check —
  so every star rating and "readers also enjoyed" list was corpus-derived. The
  flag is a build-time switch on a batch job, not a serve-time switch on a read
  path, and turning it off changes nothing already computed.

  Decided (audit OQ-1/OQ-2): serving an aggregate is not redistributing the
  corpus, so the reads are not gated. Both surfaces now carry CC-BY-SA
  attribution, driven by the `seed_count` column that had been recorded "so the
  mix is auditable" and read by nothing. Revisit if the licence position
  changes — the gate would go in `getWorkRating`, `getWorkRatings` and
  `getSimilarWorks`, and would empty both surfaces until R3 lands a corpus of
  real ratings.

## 5b. Recorded but not scoped

**A book-club surface.** The 2026-08-31 design review was briefed with a product
decision — that an active TikTok/YouTube/podcast book club is a strong secondary
audience — and its artboards give it a permanent nav slot, a module on the home
page and a carousel on the search browse screen.

Nothing of it exists: no model, no route, no data source, no requirement here.
It is the largest single item in that handoff and it is net-new product work
rather than a redesign, so the UI was **built without it** and it is recorded
here instead.

Before any of it is built this needs: what a "club" is (one global club, or many?),
where the pick, episode and note counts come from, whether membership is a
relation or just a follow, and whether any of it is user-generated or curated.
Until those are answered, an implementation would be inventing the product.

## 6. How we will know it is working

Not vanity metrics — these are the ones that would change a decision:

| Question | Signal |
|---|---|
| Can people find books? | searches returning zero results |
| Is import working? | share of import rows auto-matched, vs queued vs abandoned |
| Do the differentiators land? | works with a reader-contributed location |
| Is it fast? | p95 by route, measured against the real catalog |

None of these are instrumented yet. That is itself a gap: every performance
problem so far was found by hand.
