# Audit remediation — 2026-09-01

What changed, what was found and deferred, and what remains. Companion to
[`2026-09-01-findings.md`](2026-09-01-findings.md), which was committed before
any source change.

- **Branch:** `audit/2026-09-01`, cut from `dev` at `f85ef16`
- **Findings:** 99 (4 blocker, 47 major, 48 minor), plus 1 new open question
- **Fixed:** 4 blockers and 21 majors/minors, in 13 commits
- **Verification:** typecheck 0, lint 0, **263 unit**, **337 integration**,
  build 0 — from a clean `npm ci`

## Baseline, so nothing here is confused with a pre-existing failure

`dev` at `f85ef16` was green on all four CI commands before any change: 238 unit,
296 integration. Every finding was therefore something a green suite did not
catch — the third time that has been the case in this repo.

## The four blockers

**FLOW-10 — the importer discarded every reading date.** `Date Read` was parsed,
stored on the import row, and then used only as a boolean, while `finishReading`
stamped `new Date()`. A 300-book export spanning 2010–2024 made this year's
`/wrapped` report 300 books read and every earlier year report none, against the
settings page's explicit promise that reading dates would be imported. Journey 7
was wrong as a consequence of journey 5. Fixed by threading the date through, with
`startedAt` taking it too so `getLatestSessionForWork`'s ordering stays
meaningful. Four assertions on absolute dates — stamping the import time also
satisfies "before now", which is part of why it survived.

**TEST-1, TEST-2, TEST-3 — three route-level authorization holes, all untested.**
These were the same shape as each other, which is the finding behind the
findings: the rule lives in a route handler and the test sits one layer below it.

- Hardcoding `Boolean(user.isModerator)` → `true` in both location DELETE routes
  survived all 534 tests. The existing test called the *server function* and
  passed the flag itself, so it proved the server honours a moderator and said
  nothing about the route deriving it from the session. Any signed-in reader could
  delete every pin on the public map, permanently.
- Deleting the cross-user 403 from `users/[userId]/route.ts` broke nothing; no
  test imported the file. Any reader could edit anyone's profile.
- Unscoping the avatar blob deletion broke nothing, restoring the original
  KNOWN-2 exactly — the route's own comment states the attack.

All three now have route-level tests asserting **state as well as status**: a 403
returned after the write would pass a status-only check. Verified by applying
every mutation at once — the new tests fail; the pre-existing authorization,
storage, conventions and error-mapping suites report 43 and 63 passed
respectively against the same code.

## Majors fixed

| finding | what it was |
|---|---|
| SEC-1 | `parseBody` buffered any JSON body before Zod ran. The existing size gate had only ever been wired to the three multipart routes, so the entry point eleven routes share was uncapped: twenty concurrent 200 MB posts is 4 GB of heap. Now bounded inside `parseBody`, counting bytes as they arrive — Content-Length is advisory and absent on a chunked request, so a check that trusts it is not a limit |
| SEC-2 / FLOW-20 | five unbounded reads behind the public, anonymous `/map`, fed by three unrated contribution routes. Caps on all five, `LIMITS.contribute` on all three, and a mechanical guard listing the read paths whose input is other people's contributions |
| SEC-3 / SEC-4 / FLOW-2 | one root cause: an unidentifiable client keyed on the literal string `"unknown"`, so ten sign-in attempts from one attacker refused sign-in to **every user of the site**. And the limiter recorded a hit before checking the password, so a victim's own correct password spent the budget the attacker was draining. Now null rather than a shared bucket, and hits recorded only on failure |
| FLOW-1 | every sign-in failure rendered as "Invalid email or password", including the lockout message written specifically to tell someone to wait. Verified in next-auth's own source that a thrown error's message does arrive, so the fix is not cosmetic |
| FLOW-5 | `editionKey` was constrained only by length and the lookup did not check which work the edition belonged to — so the snapshot FLOW-28 had just made the source of truth could come from a different book, permanently |
| FLOW-7 | the home card passed a percentage against `max={100}` into a bar whose label is hardcoded "pages", rendering "15 / 100 pages" above its own correct "page 47 of 320 · 15%" |
| FLOW-19 | the fictional-world field was labelled "(optional)" and blocked submission — the previous audit's FLOW-11 reintroduced on the sibling field of the same form by FLOW-11's own remediation |
| SPEC-1 | the invariant ARCHITECTURE calls "the single most load-bearing decision in the schema" had no mechanical guard at all. Now asserted against `pg_constraint` in the suite and again in `deploy:verify`, because the schema file is not what the database enforces |
| DEAD-1 | the importer stored raw ISBNs into the column that joins against validated ISBN-13s, so an ISBN-10 matched nothing; and the parser discarded a hyphenated ISBN-13 outright. `canonicalIsbn13`, which exists for exactly this, had no caller in `src/` |
| TEST-6, TEST-17, TEST-9, DEAD-13 | four assertions that could not fail, or asserted a defect. Detailed below |
| SPEC-9 | the `timestamptz` guard checked two of the three schemas |
| FLOW-3 | the public login page printed working credentials for a seeded account, and the seed had no environment guard |
| FLOW-15, FLOW-21 | P2003 answered 500 for a deleted follow target; clearing the avatar field 400'd the whole profile edit, bio included |

### Four assertions that could not fail

Worth separating out, because they are the mechanism by which everything else
hid.

- **TEST-6** compared the returned edition counts to their own descending sort,
  which any constant list satisfies — and the fixture's counts were equal.
  Reversing the SQL to `edition_count ASC, ol_key DESC` is the exact reverse of
  the index, so it remained a no-Sort backward index scan and the plan assertions
  passed too. `/search` with no query would have shown the 24 most obscure works
  in a 6.9M-row catalog.
- **TEST-17** was worse than the audit found. The suite's only pagination test
  searched for `"the"` — **an English stopword** — so `websearch_to_tsquery`
  produced an empty query, both pages were empty, and the overlap assertion was
  asserting that `[]` equals `[]`. It had never exercised pagination.
- **TEST-9** `getReadingStats` is the "books read" number on two pages and had no
  test; dropping `finishedAt: { not: null }` counted in-progress books as read.
- **DEAD-13** two tests asserted contradictory URLs for the same job, and the one
  guarding the dead module asserted the shape the app deliberately abandoned.

### Three existing assertions were changed, and each is argued where it sits

Not weakened — each asserted behaviour that was itself the defect.

1. `ProgressBar.test.tsx` expected `150%` as correct output. Corrected to assert
   the cap **and** that the raw counts stay honest, so a real disagreement is
   still visible.
2. `rate-limit.test.ts` expected the shared `"unknown"` bucket, under a test name
   that called it the deliberate safe choice. Reversed, with the outage it causes
   written where the assertion is.
3. `error-mapping.test.ts` used P2003 as its example of an *unrecognised* Prisma
   code. Since P2003 is now deliberately mapped, it uses P1001 — relaxing the
   expectation would have thrown away the point of the assertion to make a number
   match.

## Documentation corrected

Docs must describe the code as it is. Nineteen false or stale claims were
corrected, including: the retracted seed-licensing invariant, still stated as
current in `DEPLOYMENT.md` and `README.md`; `STATUS.md`'s claim that no visual or
DOM-level assertions exist; `ARCHITECTURE.md`'s superseded slow-search diagnosis,
which the project had already established was wrong; a `pg_restore` command
passing `-j` **twice** with conflicting values, while the timing table beside it
reported the figure for the other one; two hand-checks against endpoints deleted
in `6d18243`; test counts (498 → 600), migrations (19 → 21), and the ratings row
count (five rows out).

The `deploy:verify` check count was **removed** rather than corrected. It had been
wrong in four documents simultaneously, twice, and the exit code carries the same
information.

Two previous records were corrected in place with a dated note rather than
rewritten: `work-completed.md`'s claim that R1's candidate bounding shipped (it
was reverted the next day for being 500× slower), and its claim that its own
deferred list was "accurate rather than aspirational" when it listed fourteen
fixed items.

A root `README.md` was added, because `docs/` was reachable from nothing, and the
repo's real invariants were added to `AGENTS.md`, which until now was entirely
vendor-injected Next.js boilerplate — so none of them reached a new developer or
an agent.

## Deferred, with reasons

| finding | why |
|---|---|
| SEC-6, SEC-7 | a DELETE route for worlds and a revert path for community edits are **feature work**, not defects in existing code. The reads they endanger are now capped, which removes the availability half |
| SEC-8 | the in-memory limiter is wrong for a multi-replica deployment and honestly documented as such. The fix is a shared store or a `maxReplicas` assertion — an infrastructure decision |
| SEC-9, DEAD-6, DEAD-17, DEAD-18, DEAD-19, FLOW-18 | **RECORD AND LEAVE**, per the standing rule: behaviour not covered by a test or spec line, so deleting is a judgment call the audit must not make. Includes the dead `sources/openlibrary` module, ~30 write-only columns, three unused CSP grants, and five computed-but-unrendered Wrapped statistics |
| SPEC-2 | `app.work_fictional_worlds` is a dead table that `ARCHITECTURE.md` cites as the canonical example of its own invariant. Dropping it or wiring it up is a **product decision**; only the false doc claim was corrected |
| SPEC-3 | `<CorpusAttribution />` renders unconditionally on "Readers also enjoyed", asserting CC BY-SA over readers' own reviews when the graph was built without the corpus. The fix needs a provenance column and a migration — worth doing, and larger than a doc correction |
| SPEC-10 | `deploy:verify` times a **cold** `?q=dune` against a 1 s fatal threshold — the same wall-clock shape the project deliberately deleted elsewhere, and `dune` was never the slow query. Making it non-fatal weakens a release gate; making it representative would fail on `?q=fiction`, which PRD R1 records as knowingly open. Either choice is a call about R1 |
| FLOW-6 | "Finished reading" is terminal with no re-read and no undo, though the server allows both and `progress.ts` says so explicitly. Needs two new controls and a decision about what "not finished after all" does to the Read shelf |
| FLOW-11 | the re-upload banner instructs something not implemented, and following it double-counts every finished book. Continuation needs a `rowsConsumed` column and a file identity; replacing the banner is a product choice between the two |
| FLOW-8, FLOW-9, FLOW-12, FLOW-13, FLOW-14, FLOW-16, FLOW-17 | real minors, each needing a small design choice (a cursor for the feed, a year parameter for projections, a status guard's error text) — listed in the findings with the fix |
| TEST-4, TEST-5, TEST-7, TEST-8, TEST-10 .. TEST-16, TEST-18 .. TEST-20 | the remaining test gaps, each recorded as the concrete mutation that survives. TEST-10 is the largest single one: `wrapped.ts` is 387 lines with zero tests |
| DEAD-2, DEAD-4, DEAD-5, DEAD-7 .. DEAD-16 | duplication that can diverge. DEAD-4 is the most consequential — `findAuthorKeyByName` breaks the catalog module's stated comparison rule, so every author page is a sequential scan over 3.2M rows and an accented name 404s |
| ORG-19 (part) | `bookshelf/data/` is still unmatched by `.gitignore`, only its three named children |

### Open questions — not resolved by guessing

- **Does the wiki-style editing rule require an *edit* path for locations?** The
  delete half exists for all three contributed types; the edit half exists only
  for fictional-world maps. Either the rule governs all contributed data and
  locations are missing half a requirement, or it is a permission statement about
  edits when they happen. Both readings are defensible and they imply different
  work.
- **SEC-3's live hop count.** The fix removes the outage in either topology, but
  whether `TRUSTED_PROXY_HOPS` should be 1 or 2 can only be settled by reading
  `X-Forwarded-For` from a deployed revision. Until then the per-IP limit is
  weaker than intended. `DEPLOYMENT.md` now says so.
- **OQ-6** (registration enumeration) carries over, unchanged.

## Needs action outside the repo

- **Rotate the Postgres credential in `.claude/settings.local.json`**, and the
  `NEXTAUTH_SECRET` in `bookshelf/.env.bak-before-directurl`. Both are untracked
  and correctly ignored; neither was ever committed. Outstanding since the
  previous audit.
- **Two migrations have never been applied to the development database**
  (`deploy:verify` reports "19 applied, 21 on disk"), so the "verified against a
  fresh Postgres 16" claim covers 19 of 21 until it is re-run.

## One thing I could not reproduce

During the blocker work, one full integration run reported 2 failures where every
file passed in isolation; three consecutive full runs afterwards were clean at
321, and the suite has been green on every run since. The most likely cause is
residue from my own single-file runs rather than a defect introduced — but
TEST-15 and TEST-16 record the mechanism that would make it real: `resetDatabase()`
truncates only `app.*`, catalog cleanup runs per *file* in `afterAll`, and
`catalog.subject_counts` is known to neither helper. I did not capture the failing
test names, so this is recorded as unresolved rather than explained.
