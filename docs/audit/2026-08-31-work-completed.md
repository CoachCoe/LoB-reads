# Audit remediation — 2026-08-31

What changed, what was found and deferred, and what remains. Companion to
`2026-08-31-findings.md`, which has the full finding list with file:line
evidence.

Branch `audit/2026-08-31`, cut from `audit-remediation` @ `9969905`.

---

## The result in one paragraph

All five checks were green before this branch started — typecheck, lint, 128
unit tests, 243 integration tests, a successful build — and four blockers were
in the tree, one of them a page that threw on load. Every blocker was invisible
to all five. That is the finding behind the finding, and it is why most of the
test work here is about making existing tests *able to fail* rather than adding
new ones.

## Verification

From a clean state — `rm -rf .next node_modules`, then `npm ci`:

| check | command (from `bookshelf/`) | result |
|---|---|---|
| typecheck | `npx tsc --noEmit` | exit 0 |
| lint | `npx eslint .` | exit 0 |
| unit | `npx jest --selectProjects unit --ci` | 202/202 |
| integration | `npx jest --selectProjects integration --ci --runInBand` | 296/296 |
| build | `npx next build` | exit 0 |
| migrations | `db:deploy:test`, `db:status:test` | 19/19, up to date |
| release gate | `deploy:verify` | 21/24 — see note |

498 tests, up from 371. **No suppression was introduced anywhere in the diff**:
zero `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`,
`.skip`, `.only`, `xit`, `xdescribe`, `.todo`, or `istanbul ignore` in any added
line, no `any` widening, and no change to `tsconfig.json`, `eslint.config.mjs`,
`jest.config.ts` or `.github/`. Verified by scanning the added lines of the full
diff against `audit-remediation`, not by assertion.

Two things not verified locally, both deliberate:

- **`npm run ingest -- --fixture` and `npm run db:seed`.** CI runs these against
  an empty throwaway database. Here `DATABASE_URL` points at the developer's real
  11 GB catalog and the ingest step rebuilds `catalog.*`. Not run. This is why
  `deploy:verify` reports 21/24 locally: the two failures are `catalog has works`
  and `catalog has editions`, which CI satisfies by seeding and ingesting the
  fixture first. Every configuration and schema check passes, including the two
  that BLOCK-2 and SEC-11 changed.
- **The `image` CI job.** `docker build` and the container run were not executed
  locally — but CI ran it on this PR and it **passed**.

### CI found one thing the audit did not (TEST-19)

This PR is the first time CI has ever run in this repository, and its first run
failed at the unit tests on a **pre-existing** defect the read-only phase could
not see, because it only appears under CI's environment.

`isStorageConfigured()` read `process.env.CDN_URL` at call time while every other
setting in `objects.ts` is captured at module load. `storage.test.ts`'s
`loadWith` restores the environment before returning — correct for load-time
settings — so by the time the assertion ran, CI's job-wide
`CDN_URL: https://cdn.example.invalid` was back and "reports unconfigured when
nothing can serve the files" got `true`.

Fixed at the source rather than in the test: making the module consistent is the
root cause, and adjusting the test would have hidden it. Reproduced locally by
exporting `CDN_URL`, and both suites now pass with and without it set.

### One timing assertion was removed

`catalog-search.test.ts`'s `expect(p95).toBeLessThan(100)` is gone, and the block
is renamed from "M2 acceptance" to reporting. `STATUS.md` already documented that
this test kept passing through every performance bug found at 6.9M works, and
both mutations `read-path-plans.test.ts` exists to catch leave it green — so it
gated nothing while carrying wall-clock flake risk on a loaded runner.

It was first loosened to 2000ms; the review round pointed out that a threshold
nobody chose is worse than none, which is right. The distribution is still
logged, and the query-plan assertions are the gate. Called out because it is the
one place this branch removed a check rather than adding one — the two
`expect()` lines deleted in this whole diff are this and the `X-Forwarded-For`
assertion that encoded SEC-2's vulnerability, against 78 added.

### Review round (`/bastion`)

Five findings, all accepted; four were defects this branch introduced or left
half-done.

1. **`resolvePage` clamped both modes to the search ceiling.** A subject browse
   reads an *exact* count from `catalog.subject_counts`, so `?subject=Fiction`
   has ~30,665 real pages over an indexed lookup — and the clamp made everything
   past page 42 unreachable while the pager still rendered links to page 50.
   `resolvePage` now takes the caller's own `lastPage`, and the test covers both
   modes. A regression introduced by the KNOWN-4 fix.
2. **The author page reported the truncated count as the total** — "Books (100)"
   for an author with 400. That is FLOW-16 verbatim, reintroduced on another page
   in the same PR. Now returns a real `workCount` and says when the list is cut.
3. **A non-null assertion in the avatar security fix** (`previousAvatarUrl!`).
   Restructured so the compiler knows.
4. **`ReviewCard`'s fallback linked to a page that 404s.** "Renders nothing" was
   replaced with "renders a dead link". Now plain text, and the block comment
   explaining the old code was deleted.
5. **The loosened p95 bound was replaced with no bound at all.** A threshold
   nobody chose is worse than none; the timing is logged, the plan assertions are
   the gate.

Separately, the suite caught an error in one of this branch's own new tests: the
jitter assertion used 15–30 s, but `0.5 + Math.random()` spans [0.5, 1.5), so the
real range is 15–45 s. It failed at 40.7 s. Corrected in the test and in the two
documents that stated the range. Confirmed over three consecutive clean runs.

---

## Fixed

### Blockers

**BLOCK-1 — `/my-books` shipped Prisma to the browser and never hydrated.**
`ShelfSection` is a client component and value-imported `coverUrl` from
`@/server/catalog`, whose module scope constructs a PrismaClient and evaluated
`Prisma.sql` at import time. The browser build of Prisma throws from
`Prisma.sql`, so the chunk threw during module evaluation and the page never
hydrated — the remove-from-shelf buttons were inert. Verified in the built
output before and after. `coverUrl` moved to `src/lib/covers.ts`, the dead
`SEARCH_SQL_MARKER` deleted, five type-only imports converted to `import type`,
and a conventions check added so the shape cannot return.

**BLOCK-2 — CI could never pass.** `deploy:verify` rejected `NEXTAUTH_SECRET`
on a substring match, and CI sets `${{ github.sha }}-not-a-placeholder`, which
contains "placeholder". Fixed in `verify.ts` by matching placeholder *values* and
adding the length check that carries the real protection. **A one-word change in
`ci.yml` would also fix it, and this audit was not permitted to edit CI
workflows** — worth a second look if you would rather fix it there.

### Security

| finding | what it was |
|---|---|
| SEC-1 | Rate limiter scanned every bucket on every call past 10,000 keys and could not reclaim what an attacker created — quadratic, measured, reachable with no account. Now O(1) least-recently-touched eviction. |
| SEC-2 | Both IP-keyed limits read the *leftmost* `X-Forwarded-For` element — the part the client controls. Now the trusted hop, configurable via `TRUSTED_PROXY_HOPS`. |
| SEC-3 | All three upload routes checked size *after* buffering the whole body. Now a `Content-Length` gate first. |
| SEC-4 | The Goodreads import — the most expensive route in the app — had no rate limit at all. |
| SEC-6 | Every anonymous work-page view performed a queue write the reader chose the volume of, and junk drained *ahead* of popular works. |
| SEC-7 | No moderator delete path for locations, and an orphaned contribution was undeletable by anyone, permanently, on the public map. |
| SEC-8 | `addWorkLocation` validated neither of its foreign references. |
| SEC-9 | `'unsafe-eval'` in the production CSP with no consumer; `object-src` unset. |
| SEC-10 | The cover fetcher persisted a remote-supplied `Content-Type` under year-long immutable caching, on the origin that serves avatars. |
| SEC-11 | The release gate accepted an `http://` `NEXTAUTH_URL`, which makes NextAuth drop `Secure` from the session cookie. |
| SEC-14 | LIKE metacharacters unescaped in the import's **auto-apply** author match: an author of `%` matched any author and the row was applied without review. |
| SEC-15 | An upstream `Retry-After` bypassed the backoff ceiling entirely and could strand a job for decades. |
| SEC-16 | Fifteen handlers guarded on `session.user` then keyed queries on `session.user.id`. |
| KNOWN-1 | `sanitizeFilename` returned a name *longer* than its input (150 in, 249 out) — and it becomes a blob key. |
| KNOWN-2 | Two self-owned requests deleted another user's avatar blob. Deletion is now scoped to the caller's own prefix, and `avatarUrl` is constrained to our own origin over https. |
| SEC-13 | `z.url()` accepted `javascript:`, `data:` and `vbscript:`, rendered with `unoptimized`, which bypasses `remotePatterns`. Same fix as KNOWN-2. |

### Correctness

- **KNOWN-3** — Prisma `P2025`/`P2002` answered 500. Now 404/409, without
  forwarding Prisma's message.
- **KNOWN-4** — `?page=` was bounded below only; `?page=1e8` became
  `OFFSET 2399999976`. Clamped, with the ceiling derived from `COUNT_CEILING`.
- **SPEC-4** — Work-page subject chips linked to `?q=`, which since
  `20260820140000` returns works with the word in the *title* and runs the
  documented worst-case query. One line.
- **SPEC-6** — A review whose work left the catalog rendered nothing at all; the
  intended "not in the catalog" fallback was unreachable code.
- **FLOW-6..9, FLOW-23** — Eleven client fetch sites discarded every non-ok
  response. This is the exact bug class `STATUS.md` calls the largest defect ever
  found here; the moved route was fixed and the handler shape was not. Server
  messages like "That edition has N pages" had never been visible to anyone.
- **FLOW-11** — The location form labelled required coordinates "(optional)".
- **FLOW-15** — Public shelves had no link from anywhere a reader would look.
- **FLOW-16** — `/my-books` displayed the preview cap as the shelf's book count.
- **FLOW-17** — The register form's password rule was weaker than the server's,
  and its placeholder actively misinformed.
- **FLOW-18** — A successful import rendered in the error style.
- **FLOW-21** — `/wrapped?year=abc` returned 500.
- **FLOW-22** — The author page loaded every work by an author, unbounded.
- **ORG-6** — One page imported prisma directly, contradicting two documents;
  `conventions.test.ts` could not see it because it walked only `src/app/api`.

### Tests

TEST-4, TEST-5, TEST-6, TEST-12, TEST-13, TEST-14, TEST-15, TEST-17, DEAD-3 —
each was a test that could not fail while claiming to cover something, or a
script that could not pass. The mutations named in the findings were applied and
confirmed to fail the new assertions, then reverted. New coverage for
`validateImageFile` (the upload path's only content control, previously an empty
`describe`), `updateProfileSchema`, `resolvePage`, `declaredBodyTooLarge`, real
Prisma errors, moderator deletes, and the rate limiter's bucket accounting.

### Hygiene and docs

DEAD-7, DEAD-10, DEAD-12, DEAD-17, DEAD-18, DEAD-20, DEAD-22, ORG-2, ORG-3,
ORG-5, ORG-8, ORG-9, ORG-10, ORG-11, ORG-12, ORG-13, ORG-14, ORG-15, ORG-16,
ORG-17, ORG-18, ORG-20, SPEC-2, SPEC-8, SPEC-9, SPEC-10, SPEC-11, SPEC-12,
SPEC-13.

Notable: `ARCHITECTURE.md` quoted a `TRUNCATE` the ingest no longer contains and
called the delivered rebuild-and-swap "Not yet implemented"; it also claimed
there was no index on `subjects` while `deploy:verify` asserts that index exists.
`README.md` documented three API methods that do not exist. `M4` was marked Done
while covers are not served at all.

---

## Second round — the deferred defects, after review

Everything below was originally deferred and has since been fixed. What remains
deferred is only what needs a product decision or is feature work; the list at
the end of this document is now accurate rather than aspirational.

**SEC-5 — `isModerator` frozen in a rolling JWT.** The flag was copied in at
sign-in and never re-read, and NextAuth re-encodes with a fresh expiry on every
session read, so for an active user the 30-day default never arrived. Demoting a
moderator did nothing: they kept deleting other readers' maps and blobs. Now
re-read on a five-minute interval, with `session.maxAge` bounded to 24h, and a
deleted account's token blanked so the route guards SEC-16 made consistent turn
it into a 401. Seven tests calling the callback directly.

**FLOW-13 — import rows reported as matched when nothing applied.** `applyRow`
swallowed all three steps and the callers wrote `matched` regardless, so
`matchRate` — the metric PRD section 6 names — counted failures as successes. It
now reports whether the row reached a shelf; `failed` (which already existed and
nothing set) is recorded with a reason, carried by a new `error` column.

**FLOW-14 — a finished book reverted to "Start Reading".** The panel read the
open-sessions list, so a finished book looked unread; pressing the button opened
a second session and double-counted it in `/wrapped`. `GET /api/progress` now
accepts `?workKey=`.

**TEST-10 — `reclaimStale` measured from the wrong column.** `created_at` is
when a job was enqueued, so a worker's live batch was handed to a second worker.
A migration adds `claimed_at`, set in the same UPDATE that claims the row.

**FLOW-24, FLOW-25** — one definition of "books read" (finished sessions, as
`/wrapped` uses), and a shelf page that can be paged instead of showing 100 of
800.

**TEST-9 — authentication checked per handler.** The old check asked whether a
route FILE mentioned a session helper; six files export more than one mutating
handler. Removing the session call from only `follow`'s DELETE now fails and
names it, while the file still contains `getServerSession` three times.

**TEST-1, TEST-2, TEST-3 — the three tests that asserted against copies of the
code they guard.** These were called "the most valuable remaining work in this
repo" and they are done:

- `read-path-plans` now EXPLAINs `Prisma.Sql` builders exported from
  `catalog.ts`. All three mutations its own header lists are caught. One needed
  a better assertion as well as real SQL: at fixture scale the mutated
  `getPopularWorks` ordering still uses the index and still has no external
  merge, so the discriminating property is the presence of a **Sort node** —
  which holds at any scale, unlike the row bound.
- `recommendations` now calls the shipped `computeRatingStats` /
  `computeSimilarity`, with the seed decision passed as a parameter rather than
  read from `process.env` at module scope (the TEST-19 shape). Mutating the
  cosine score to raw co-occurrence now fails. Recorded honestly in the test:
  mutating the window's `ORDER BY` alone still passes, because that only picks
  which neighbours survive the cut and the read path orders by the stored score.
- `core-loop`'s gap is closed in `conventions.test.ts` instead, so it covers
  every component rather than one page — which is also PRD R7. Every `/api/...`
  literal must resolve to a route, and every method a fetch names must be
  exported by it. The M3 defect now fails the suite.

**TEST-20 — a fixture inheriting the previous test file's rows.** Found while
doing the above: `beforeAll` runs before the first `beforeEach`, so
`recommendations` built its aggregates over whatever `app.reviews` the preceding
file left. Diagnosed rather than papered over — reverting the fix reproduces
`Expected: 8, Received: 7` deterministically with `import-routes` running first.

Two stale things fell out of the mechanical checks: `ImportReviewList` composed
its URL from an interpolated action (unresolvable, now written out), and
`useCrowdsourcedLocations` documented its endpoint as `/api/books/...` — the
path M3 retired.

---

## Third round — the open questions, answered

All eight open questions were answered by the maintainer. What follows is what
each decision produced.

| question | answer | what changed |
|---|---|---|
| **OQ-7** public HTTP API? | No | Six unreachable read handlers deleted (25 routes → 23), README's list corrected and given the rule. Settles DEAD-4. |
| **OQ-1 / OQ-2** seed licensing | Serving aggregates is acceptable; attribute | No runtime gate. CC-BY-SA attribution on both surfaces, driven by `seed_count` — a column recorded "so the mix is auditable" that nothing had ever read. PRD §5 and three other documents corrected: they claimed "nothing derived from it is served" while every work page served it. |
| **OQ-4** is `/map` public? | Yes | Redirect removed; the navbar now renders Home, Discover, Map and About for signed-out visitors, who previously got no navigation at all and, on a phone, not even a search box. A conventions test pins the public-page list. |
| **OQ-6** registration enumeration | Recommendation accepted | Message kept. Without email verification, a generic response means a reader who forgot they have an account gets a success message and no account — a frequent harm against a modest disclosure — and SEC-2 made the 5/hour cap real. Reasoning recorded next to the code with the condition that would reopen it. |
| **OQ-8** which table owns work↔world | Recommendation accepted | Counted from `app.work_locations`, the table readers actually write, DISTINCT by work. Every world previously read "0 books" outside a dev-seeded database. |
> **Corrected 2026-09-01 (ORG-8).** The bounding described in this
> section was **reverted** in `92128f3`: it made `?q=dune` 500x slower
> (71 s query, 116 s page) against the real 6.9M-work catalog, because
> `ORDER BY edition_count DESC LIMIT n` invited an index-order walk that
> filtered 6,943,467 rows. `src/server/catalog.ts` is a single unbounded
> ranking pass, and `read-path-plans.test.ts` now asserts exactly one
> `LIMIT`. PRD R1 is open. The text below is left as written.

| **OQ-3** approximate search results? | Yes | R1's candidate set is now bounded — see below. |

**BLOCK-3 and BLOCK-4 followed from OQ-7.** Both had working, tested routes and
no UI, which is why the audit refused to delete them. Custom shelves now have a
create form and a delete control on `/my-books`; fictional worlds have a create
form in the map panel, without which the entire upload/edit/delete chain and
`WorkLocationsSection`'s world picker were unreachable on any database that had
not been dev-seeded.

### R1, and what is honestly still open

`searchWorks` ranked every match before `LIMIT` discarded all but 24. The
candidate set is now capped **per strategy** rather than by one
popularity-ordered cap: exact and prefix titles get their own reservations, and
full-text and trigram are capped in `edition_count` order. A single cap would
have dropped an exact title match with few editions — a reader searching a book
they own and not finding it.

**The latency is unmeasured.** It is verified for shape, and for the property
that matters (an exact title with the fixture's lowest `edition_count` still
ranks first among 3,000 competitors; removing the reservations fails that test).
But this repository's history is a list of performance conclusions drawn from
fixtures that did not survive 6.9M works, so PRD R1's "done when" is now tied
explicitly to a measurement on the real catalog. Do not mark R1 done on the
strength of this change alone.

---

## Needs your action

**Rotate the Neon Postgres credential in `.claude/settings.local.json`.** It sits
there in plaintext inside two Bash allow-entries. It has **never been
committed** — verified across all history; the only credentials ever committed
are `postgres:postgres` for local/CI and Azurite's published emulator key — but
it was protected only by `~/.config/git/ignore`, a machine-global file outside
the repo, while the repo's own root `.gitignore` was one line (`.vercel`). The
repo now ignores it, which prevents the next accident but does not undo the
exposure. The audit did not edit that file: it is your local machine
configuration, not repo source. Two side notes on it — it allows
`npm run db:push`, the one script `README.md` says to avoid, and it carries a
commit template with a `Co-Authored-By` trailer your global rules forbid.

Also worth deleting locally: `bookshelf/.env.bak-before-directurl`, which
carries the same `NEXTAUTH_SECRET` as the live `.env`, and `bookshelf/.vercel/`,
which is stale now the target is Azure.

---

> **Corrected 2026-09-01 (ORG-1).** This document's summary claims the
> list below "is now accurate rather than aspirational". It is not: it
> still presents as deferred at least fourteen items that its own later
> rounds fixed, and the code confirms fixed — BLOCK-3, BLOCK-4, FLOW-2,
> FLOW-4, FLOW-13, FLOW-14, FLOW-24, FLOW-25, SEC-5, SEC-12, TEST-9,
> TEST-10, TEST-1/2/3, OQ-7 and OQ-8. As of 2026-09-01 the genuinely
> deferred items from this round are **FLOW-5, FLOW-10 and SPEC-2**
> (verified: `getRecentImports`, `getWorkReviews` and `getAverageRating(s)`
> still have no caller in `src/`). The table below is left as written
> rather than edited, because a dated record that keeps being rewritten
> is worth less than one with its errors marked.

## Deferred, with reasons

### Blocked on a product decision — logged, not guessed

- **SPEC-1 — seed-derived ratings and recommendations are served.**
  `ENABLE_SEED_DATA` gates the batch job, never the response: the flag decides
  whether `seed.ratings` joins the UNION at compute time, and the read paths
  select from the resulting `catalog.*` tables unconditionally. `PRD.md` §5 says
  "nothing derived from it is served", which the code does not honour;
  `ARCHITECTURE.md` reasons about *redistribution*, which is narrower. **Nothing
  was changed** — filtering the reads would remove ratings and "readers also
  enjoyed" from every work page, and R3 explicitly wants more of both. It needs a
  licensing decision (open questions OQ-1, OQ-2), not an inference.
- **FLOW-2 / SPEC-14 — `/map` redirects anonymous visitors to `/login`.** R6
  reads as a discoverability problem, so the obvious R6 fix would send readers
  into a login wall. Whether the map is public is OQ-4.
- **SEC-12 — registration is an account-enumeration oracle**, undoing the timing
  work done on sign-in. Closing it costs the "this email is already registered"
  message. OQ-6.
- **OQ-7 — is there meant to be a public HTTP API?** Six read handlers have no
  in-app caller but five are documented in `README.md`. The answer decides
  whether they and their README lines go, or gain tests.
- **OQ-8 — which table owns work↔world association?**
  `app.work_fictional_worlds` is counted and never written;
  `app.work_locations` is written and not counted (SPEC-7, so the map's
  per-world book count is always zero).

### Feature work, not defects in existing code

- **BLOCK-3 — custom shelves cannot be created or deleted.** `README.md`
  advertises "unlimited custom shelves"; `POST /api/shelves` and
  `DELETE /api/shelves/[shelfId]` work and no UI calls them. `/my-books` renders
  a "Custom Shelves" section that can never be non-empty. Left as a blocker
  rather than fixed: it needs UI, and OQ-7 decides whether that or removal is
  right.
- **BLOCK-4 — no UI creates a fictional world**, so the whole upload/edit/delete
  chain is unreachable on any database that has not been dev-seeded.
- **FLOW-4 / SPEC-5 — the navbar hides every link from signed-out visitors**, and
  on mobile they get no search box and no menu at all. PRD R6 already owns this
  as P2.
- **FLOW-5** — the import review queue is reachable only from transient client
  state; `getRecentImports` exists and has no caller.
- **FLOW-10** — a rating changes nothing visible, and no page lists other
  readers' reviews of a work. `getWorkReviews` and `getAverageRating` have no
  callers. Entangled with SPEC-1.
- **SPEC-2** — stored covers are never served. The doc claim is corrected; wiring
  it is R4.

### Real defects needing a design choice larger than an audit fix

- **FLOW-13** — import rows are marked `matched`/`confirmed` even when nothing
  was applied, so the match rate the PRD names as its decision metric overstates
  reality. `applyRow` swallows all three steps. Needs a status model.
- **FLOW-14** — a finished book reverts to "Start Reading" on reload, and
  re-finishing double-counts in `/wrapped`. Needs a per-work progress endpoint.
- **FLOW-24** — "Currently Reading" and "Books read" have different definitions
  on different pages.
- **FLOW-25** — `/shelf/[shelfId]` shows 100 items and the full count with no
  paging.
- **SEC-5** — `isModerator` is frozen into a rolling 30-day JWT and never
  re-read, so a demotion cannot be enforced and a deleted account's cookie still
  authenticates. The correct fix adds a database read to the `jwt` callback;
  that wants a deliberate decision on session cost and a test that mocks it.
- **TEST-10** — `reclaimStale` compares `createdAt` against a cutoff, but that is
  when the job was *enqueued*, not claimed, and there is no `claimed_at` column.
  A worker's fresh batch is returned to `pending` mid-flight. Needs a migration.

### The deepest test findings, deferred

**TEST-1, TEST-2, TEST-3.** Three files assert against copies of the code they
claim to guard:

- `read-path-plans.test.ts` `EXPLAIN`s SQL typed into the test, so three of the
  four bugs its own header lists can be reintroduced while it stays green.
- `recommendations.test.ts` re-implements the cosine ranking, so replacing the
  shipped `ORDER BY` with raw co-occurrence — the documented bug it exists for —
  passes all 11 tests.
- `core-loop.test.ts` hand-types the request bodies and route paths, so it
  verifies what the test sends, not what the component sends. Pointing
  `AddToShelfButton` at `/api/shelves/{id}/books` again would not fail it.

Each needs exporting query builders or script internals and rethreading the
tests — a substantial refactor of a currently-green suite, and the wrong thing
to attempt in the same pass as 40 behavioural fixes. They are the most valuable
remaining work in the repo: they are why a green suite missed four blockers.

**TEST-9** — `conventions.test.ts` checks authentication by string presence and
never authorization. A latent gap rather than a live bug (the current code passes
`user.id`), so recorded.

### Recorded and left, per the audit's own rule

Code with no consumer whose behaviour is covered by neither a test nor a spec
line: DEAD-2 (`openlibrary.ts` — partly test-covered, partly not, so left
whole), DEAD-4 (six unreachable read handlers), DEAD-6 (a second, dead rating
aggregation), DEAD-13, DEAD-14, DEAD-15 (`Badge.tsx`), DEAD-16, DEAD-24. Also
DEAD-19 (over-exported symbols — cosmetic, and two are wanted by the test work
above) and DEAD-23 (superseded indexes in applied migrations, which are
append-only by definition).

### Unverifiable here

ORG-21 and every measured figure — 6.9M works, 161m26s normalize, the 479 MB
image, the latency tables, the 11 GB database. Nothing in the code contradicts
any of them; they cannot be re-derived from source. Two disagree with each other
across documents (5,518,739 vs 5,518,744 ratings; 8,663 vs 8,659 rated works) and
are flagged rather than corrected, because guessing which is right would make the
document less trustworthy, not more.

---

## Recorded assumptions

The audit brief carried placeholders that do not resolve against this repo. These
were resolved from the repository rather than guessed, and are restated here
because they change what "done" means:

1. **There is no `dev` branch.** `audit-remediation` is 53 commits ahead of
   `main` and 0 behind, and no PR has ever been opened, so it is the active
   development line. It plays the `dev` role: this branch was cut from it, the PR
   targets it, and nothing was pushed to it directly. Retarget the PR base if
   `main` was intended.
2. **"Gap docs a–d" do not exist**, and there was no `docs/` directory before
   this audit. `PRD.md` + `STATUS.md` + `ARCHITECTURE.md` were used as the specs;
   commit `0870b0d` ("Fold the audit into STATUS and the PRD") confirms that is
   deliberate.
3. **Commands** were taken from `.github/workflows/ci.yml`, the only authority
   that matches CI.
