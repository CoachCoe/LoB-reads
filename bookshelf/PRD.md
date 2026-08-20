# PRD — Life on Books

What to build next, and why. Deliberately short. `STATUS.md` has the evidence
for every claim of fact here.

> **Open input needed.** Bhavia's requirements are not recorded anywhere in this
> repository — not in a document, not in 71 commits of history. The priorities
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
recommendations. 335 tests pass.

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

**R1. Search must answer in under a second for any query.**
Today a common word takes 4.2 s and the discover page's own subject chips used
to lead straight into the worst case. Bound the candidate set so ranking never
reads more than a fixed number of rows, and raise `shared_buffers`.
*Done when:* no query in a representative set exceeds 1 s warm, and a plan
assertion holds the bound.
*Open question for you:* approximate results for very common words — is that
acceptable? It is the only way to bound the work.

**R2. A catalog rebuild must not take the site down.**
`TRUNCATE` inside the normalize transaction holds an exclusive lock for hours,
so every read blocks. A monthly rebuild is therefore a monthly multi-hour
outage. Normalize into parallel tables and swap with `RENAME`.
*Done when:* search and work pages stay served throughout a full rebuild.
*Bonus:* removes ~34 GB of bloat and most of the nine-hour runtime.

### P1 — the product works but under-delivers

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

**R5. Deploy it.**
`DEPLOYMENT.md` is written and costed. Nothing is provisioned. `next build`
OOMs on a t3.micro, so build in CI and ship the artifact.
*Needs from you:* AWS account, `GOOGLE_BOOKS_API_KEY`, `S3_BUCKET`.

### P2 — worth doing, nothing waits on it

**R6. Make the location features discoverable.** They are the differentiator
and they are buried on work and author pages. A reader with no account has no
route to the map. (`WorkLocationsSection` was in fact unreachable until
recently — built, wired to nothing.)

**R7. Generalise the reachability check.** `core-loop.test.ts` now asserts the
work page mounts its components, but only that page. Three separate components
were found wired to nothing; a check that covers every page would have caught
all of them at once.

**R8. Housekeeping.** Align Postgres 14 local with 16 in CI and RDS; move rate
limiting to a shared store before running more than one instance; delete
`.env.local`, which points at an abandoned database and breaks `npm run dev`.

---

## 5. Explicitly not doing

- **Widening the catalog beyond the English 1900+ ISBN slice.** 6.9M works is
  not the constraint on this product; discovery is.
- **Filtering the catalog to the rating corpus.** Implemented and left off: it
  would cut 6.9M works to 8,659. Its original purpose was fitting the AWS free
  tier, and the full catalog is 11 GB against a 20 GB limit.
- **Serving anything derived from seed data.** `seed` is CC-BY-SA and
  ShareAlike is viral. It stays behind `ENABLE_SEED_DATA` and nothing derived
  from it is served.

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
