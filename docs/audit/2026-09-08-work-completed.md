# Audit remediation — 2026-09-08

Branch `audit/2026-09-08`, cut from `origin/dev` at `fe5e7f2`. Findings are in
`2026-09-08-findings.md`, committed before any source changed and not edited
since. This file records what was fixed, what was deferred, what was wrong, and
what still needs a person.

## The gate

| check | before | after |
|---|---|---|
| `npx eslint .` | pass | pass |
| `npx tsc --noEmit` | pass | pass |
| unit | 25 suites, 288 tests | **27 suites, 326 tests** |
| integration | 24 suites, 422 tests | **25 suites, 450 tests** |
| `npx next build` | pass | pass |
| `prisma migrate status` | 25 migrations, up to date | **26**, up to date |

710 tests to **776**. Phase 3 was run from a fresh `npm ci` with `.next` and
`tsconfig.tsbuildinfo` deleted.

The integration run no longer prints "Jest did not exit one second after the
test run has completed" — that warning had a cause in source, not in the runner
(TEST-40).

**No new suppressions anywhere in the diff.** Zero `@ts-ignore`,
`@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` or `as any` on any
added line; `tsconfig.json`, `eslint.config.mjs`, `jest.config.ts` and
`.github/` are untouched. Two greps matched and both are benign: a comment in
`health.ts` reading "rather than `--forceExit`", and the `as never` cast on
route-handler params, which is this repo's established pattern in route tests
with nine occurrences on `dev` already.

## Two things the tests could not catch

Worth putting first, because they are the argument for the way this round was
run.

**A running application found three of the four blockers.** `finishReading`
counting one book five times, the typo search returning nothing a quarter of the
time, and the multipart size gate being bypassable were all found by driving the
app over HTTP against the real 6.9M-work catalog — not by reading it. The suite
was green throughout.

**A clean build found a regression the suite did not.** Adding `?callbackUrl=`
to `/register` broke `next build` with a prerender error, while lint, typecheck
and 773 tests all passed. Phase 3 exists for exactly that.

## Fixed

### Blockers

**RUN-1 — "Finish" logged a new book every time it was pressed.** No open
session meant a new already-finished one, and the partial unique index only
constrains open sessions. Five clicks rendered "5 Books Read · 880 Pages Read"
for one 176-page book; re-uploading a Goodreads export did the same per row.
Deduplicated on a calendar day in UTC — a window, not an exact timestamp,
because the importer passes the same parsed date on every re-upload while a
double-click passes two `new Date()`s milliseconds apart. Two of the five new
tests assert the fix did **not** go too far: a re-read a year later still
counts, and two readers finishing the same work on the same day still count
separately.

**RUN-3 / SPEC-2 — neither search gate could fail for the failure mode R1's
design introduced.** A timed-out arm returns nothing *faster*, so
`bench:search` (latency only) and `deploy:verify` (status and clock) both read a
broken search as an improvement. Each benchmark query now carries a `minRows`
floor checked on every repeat, and `timeOnce` returns the value with the clock
so both come from the same call. Proved by squeezing the budget to 50 ms:
exit 1 with six recall failures, every one of them *faster* than before.

**SPEC-1 / SPEC-16 — fourteen release-gate checks never ran, and the skip was
counted as a pass.** `check("HTTP checks", true, "skipped …")` was hardcoded
`ok: true`, so both probes, the CSP assertions, HSTS and the four per-arm search
timings were skipped *and* counted toward "N/N passed" — which is the state of
every automated invocation, since neither workflow sets `BASE_URL`. Now a
warning, and fatal when a deployment target is configured.

**SEC-1 — both `NEXTAUTH_SECRET` gates passed a known placeholder.**
`your-secret-key-change-in-production` is 36 characters, so it cleared the ≥32
floor, and was not among the six exact strings, so it cleared that list too. It
is in this repo's own git history. Added to the list; a fresh
`openssl rand -base64 32` still passes.

**TEST-21 — two DELETE routes decide authorization and no test exercised
either route.** Demonstrated rather than asserted: with the hole introduced —
the route taking the actor from the request body — `authorization.test.ts`
**passes** and the new `delete-route-authorization.test.ts` fails. Eleven cases,
each asserting state as well as status.

### Majors

- **RUN-2 / SPEC-4** — the 700 ms fuzzy budget did not clear the query its own
  comment was calibrated on. Split into 900 ms fuzzy and **300 ms
  exact-title**, which are different queries with nothing in common but a
  `SET LOCAL`; the stopword path went from ~990 ms to ~380 ms. Two plausible
  cheap fixes were measured and **rejected**: raising the similarity threshold
  changes nothing (the GIN index cannot apply it — same 76,457 candidates), and
  dropping the stopword makes it 24 ms and finds 1 row instead of 20. The
  docstring now says plainly that no timeout fixes this, and why: ~70,000 heap
  block reads that cannot stay resident in a 128 MB `shared_buffers`.
- **RUN-6 / JB-1** — `GET /api/authors/<name>/locations` returned 500 for the
  eight catalog authors whose names contain `%`, so the locations panel — one of
  two stated differentiators — could not load for them, anonymously reachable.
  Next 16 hands `params` to a route handler already decoded and to a page
  component still encoded; all four sites decoded, so three decoded twice.
- **JR-2** — five private pages guarded on `!user` rather than `!user?.id`, so a
  deleted account got a working-looking empty library. Fixed with one
  `requireUser` helper, not five corrected copies, and generalised: a conventions
  check now asserts every private page uses it.
- **JR-1** — an emptied review textarea could not clear the text. The test is a
  *component* test asserting the request body; two integration tests I wrote
  first passed against the unfixed code and were deleted rather than kept.
- **JR-3 / JB-6 / JC-13** — four surfaces linked works and authors the catalog
  no longer has, against an AGENTS.md invariant that claims to have a test.
  Fixed with one `WorkLinkOrPlaceholder`, because the recurring shape is that the
  link *wraps* the card. `map.ts` no longer substitutes a display string, since a
  read that does cannot tell present from absent.
- **JB-2** — no 404 or error page existed, so `notFound()` on four public read
  paths rendered Next's built-in shell with no navigation. See the limitation
  below.
- **JB-7** is **not** fixed — see Deferred.
- **SEC-3** — `POST /api/reviews` was unrated and feeds the public home page.
- **SEC-4 / TEST-38** — the map upload wrote unbounded title and description
  while the edit path capped both, and the world list read every map of every
  world. The check that should have caught it asserted the function body merely
  `toContain("take:")`, satisfied by the world-level cap; it now names each
  constant and has a second list for nested reads.
- **SEC-5** — the community map `PATCH` was the only mutating handler both
  ownership-free and unrated.
- **SEC-7 / RUN-7** — confirmed by running, not left as reasoning: a chunked
  12 MB upload bypassed the 5 MB declared gate entirely (413 → 503). **Not
  fixed** — see Deferred.
- **SEC-8** — LIKE metacharacters were unescaped in the ranking expression's
  prefix bonus. A second CTE column, because `norm` is also compared with `=`
  and passed to `similarity()`.
- **JC-3** — the author-location year range was enforced in the POST handler
  only, so PATCH could write "1920–1890" — against the invariant the schema
  states three lines away. Moved into a refinement both schemas share.
- **JC-7** — the route accepted a fictional location with no world; only the
  client blocked it.
- **SPEC-15** — the trigram shape assertion pinned one spelling of one operator,
  so `WHERE similarity(...) > 0.5` passed. It now splits on `WHERE` and rejects
  `%`, `%>`, `<%` and `similarity(`, while asserting the ranking call is still
  there so the fix cannot be "delete similarity()".
- **DEAD-2** — a shelf display name was silently a join key with no type
  relation to the shelves an account has. Now a total
  `Record<GoodreadsShelf, DefaultShelfName>`, and the primary guard is the
  compiler: renaming a default shelf is `TS2322`.
- **TEST-40** — the leaked timer behind "Jest did not exit". A source fix, since
  it also leaks one live timer per readiness probe in production.

### Minors

RUN-5/JR-9 (shelf re-add reset `addedAt`), JR-11 (pages read ignored logged
pages — raw SQL, applying both of this repo's recorded traps: mixed-case
quoting and the `::int` bigint cast), JR-15 (hand-rolled 401/500),
JR-19 (`getSafeCallbackUrl` rejected any colon), JR-21, JB-5/JC-5 (signed-out
upload affordances dead-ending at a 401 toast), JB-9 (`npm run ingest` shown to
readers), JB-13 (no `callbackUrl` on Sign In/Sign Up — which required making
`/register` honour one at all), JB-14 (About described a search the code
deliberately does not do), JC-12, SEC-11/DOC-21 (`SEARCH_FUZZY_TIMEOUT_MS`
validated at import; a typo became `NaN` in a `SET LOCAL` and 500s both
fallback arms), SEC-12 (`Retry-After: -1` scheduled a retry in the past).

### Documentation

Twenty-eight findings. The ones that mattered were contradictions, not stale
numbers — five of twelve duplicated blocks had already drifted. DEPLOYMENT.md
presented R1 as open with a 1.23 s figure four other sources contradict;
ARCHITECTURE.md's Covers section claimed stored covers in a heading while every
cover is hotlinked; `.env.example` recommended `TRUSTED_PROXY_HOPS=1` where
DEPLOYMENT.md and CI both say 2; README.md and AGENTS.md named the wrong file as
constructing the PrismaClient; `R2b` was cited by three documents and did not
exist. Corrected numbers: database 12 GB not 11, Fiction 10,061 not 10,120, test
count 773 where two files said 627 and 665, M5 coverage 55.3% not 100%.

New: a Provisioning section in DEPLOYMENT.md — there is a 10.6 KB Bicep template
and an `azure.sh provision` subcommand and the deployment guide never mentioned
either — with the three things the template does not do that will fail the gate.
And a "which document owns which fact" table in README.md, because the drift
above is what happens without one.

## What /bastion found

Two defects, both introduced by me in this round, neither caught by the 776
tests that were passing.

**RUN-1's fix closed the sequential case and left the actual one open.**
`finishedSessionOnDay` is a read followed by a create, and a double-click — the
case the dedupe exists for — is concurrent. Measured: two simultaneous finishes
produced two sessions. The rule moved to where the exclusive-shelf rule already
lives, as a partial unique index on `("userId", work_key, UTC day)`, with a
dedupe of existing rows first because the index cannot be created over the
duplicates the defect has already written.

That surfaced a second race in `moveToExclusiveShelf` — DEAD-17's duplicate of
the shelf move, with the same delete-then-create shape and the same `addedAt`
reset fixed in its sibling. It now deletes from the other shelves and upserts
the target, and checks the end state on a unique violation rather than
reporting a conflict the reader did not cause. That is JR-10's docstring
finally being true.

**The behavioural race test is only a probabilistic detector**, and this is
recorded rather than glossed: with the index dropped it passed five times in a
row, because three calls can serialise by luck. The deterministic assertion is
in `schema-invariants.test.ts` against the index definition, and it fails the
moment the index is gone.

**Validating `SEARCH_FUZZY_TIMEOUT_MS` by throwing was worse than the NaN it
replaced.** Throwing at module scope is the usual advice and is wrong here:
this module is imported lazily by pages and routes while `health.ts` imports
only `@/lib/prisma`. Measured, with a bad value: both probes 200, every page
500 — verbatim the failure `ci.yml`'s container job exists for. A fail-fast the
orchestrator cannot see is worse than the defect it replaced. It logs and uses
the documented default now.

Three `wrapped.test.ts` fixtures finished one work up to sixty times in a day
for convenience — the RUN-1 defect as a fixture. They use distinct works; every
assertion is unchanged.

## Two findings that were wrong

Recorded because a findings file that is never wrong is not being checked.

**SEC-10's eviction claim.** The audit reported `rate-limit.ts` evicting the
least-recently-*created* bucket rather than least-recently-touched, on the
grounds that a plain `Map.set` does not reorder. That is true of `Map.set` and
false of this code: there is already a `buckets.delete(key)` before the limit
check, with a comment explaining delete-then-set. The eviction is genuinely LRU.
I had begun the change before reading far enough up the function; it is
reverted and `rate-limit.ts` is untouched.

**JB-1's severity.** Reported as "the author page 500s". The page returns 200
and renders correctly; only its `<title>` is lost. The API is what 500s. Kept as
a major rather than a blocker, and the corrected shape is what the fix was built
against.

## Deferred, with the reason

- **DEAD-1 / JC-1 — the location edit UI.** PRD §2's "anyone signed in may
  edit" is built end to end below the UI and nothing calls it. Verified by
  driving the routes: a second account's edit is accepted and recorded in
  `updated_by_id`, and its delete is refused — the rule is implemented exactly
  as written and simply unreachable. Building the control is feature work.
  Recorded in PRD R8 with a *Done when*, and it needs OQ-1 answered first: the
  alternative reading makes it dead code to revert rather than wire up.
- **SEC-7 — the multipart byte-counting bound.** Confirmed exploitable by
  running. The fix is a length-counting reader replacing `formData()` on three
  routes, which changes how uploads are parsed; too large to land safely at the
  end of this round, and the per-account limits bound it meanwhile.
- **SEC-6 — `TRUSTED_PROXY_HOPS` over-counting.** Fails open and silently, and
  removes the only cap on account creation. The fix touches the limiter's
  fallback semantics and interacts with SEC-14 (bcrypt cost); wants doing
  together, deliberately.
- **RUN-4 — mixed column naming inside single tables.** `reading_sessions` has
  `"userId"` and `"currentPage"` camel with the rest snake. A rename with `@map`
  keeps the Prisma API unchanged but is a migration against a deployed database
  (OQ-10). It cost time inside this audit — three psql queries failed in a row —
  so the trap is real, and JR-11's new raw SQL documents it in place.
- **JB-7 — the work page's hero cover is not the work's cover edition** (291 of
  300 sampled). The fix is a join in `getWorkByKey`, which is small, but it
  changes what every work page displays and belongs with a look at the page
  rather than at the end of an audit.
- **JR-4, JR-5, JI-1, JI-3, JI-4, JI-6, JC-4, SEC-16, JC-9** — each needs a
  product decision or a migration; all have an open question in the findings
  file. JI-2 (the unbounded trigram query in the importer) is a clear fix and is
  the first one to take next: it is the same predicate R1 was closed by
  bounding, called once per unmatched row with no timeout.
- **Everything under "record, do not delete"** — nine dead exports,
  `ui/Badge.tsx`, `tmp-prov.ts`. The charter's rule covers them and OQ-9 asks
  for a decision on the last.

## One limitation introduced deliberately

The 404 page. For `notFound()` from a dynamic page, Next 16 delivers the UI in
the RSC payload rather than the initial HTML, so the body is empty until
hydration. A segment-level `not-found.tsx` — the shape Next's own docs
demonstrate — behaves identically; I tried it and removed it. So a reader in a
browser now gets a styled page with navigation instead of an unstyled "404:
This page could not be found", and a reader without JavaScript gets an empty
body instead of that line. The status is 404 either way, which is what a
crawler reads. Stated in the file and worth revisiting when Next renders this
server-side.

## Needs a person

1. **Add `BASE_URL` to the `Release` step of `.github/workflows/deploy.yml`.**
   Fourteen release-gate checks have never run in automation. This round does
   not edit CI workflows, so the one-line change is left here — the gate now
   fails loudly about it when a deployment target is configured, rather than
   reporting a pass.
2. **Rotate the Neon Postgres credential** in `.claude/settings.local.json`.
   Untracked, correctly ignored, and — verified three ways — never committed.
   Outstanding since 2026-09-01.
3. **Rotate `NEXTAUTH_SECRET` and delete `bookshelf/.env.bak-before-directurl`.**
   The value in `.env` is the placeholder now on the gate's reject list, and it
   is in this repo's git history. Also outstanding for two rounds.
4. **Answer OQ-1** (is the wiki edit rule settled?), which is blocking a
   blocker, and **OQ-2** (is a stopword query returning nothing acceptable?),
   which decides whether `title_norm` gets a btree.

## Verification

`bench:search --gate` passes, and it is worth saying what that now means: it
checks recall as well as the clock. **Expect `the hobbitt` to fail it
occasionally.** That query needs 602–801 ms clean and has been seen at 989 ms
under benchmark load, against a 900 ms budget — the failure is the defect
recorded in RUN-2, not flaky tooling, and it should stay reported until the
candidate-set cost is addressed rather than being silenced by relaxing the
floor.

One of nine consecutive integration runs failed on "Can't reach database
server at localhost:5432", in a test this branch does not touch. That is a
local Postgres blip from running the full suite repeatedly, not a code defect —
Postgres was healthy at 8 of 100 connections afterwards and the two runs after
it passed. Recorded because a run that failed should be reported, not averaged
away.

The journeys were re-walked over HTTP against the clean build: every public and
private page 200s, a missing page 404s, registration and sign-in work through
the real routes, and the eight `%`-named authors now return 200 from both the
page and the locations API with no `URIError` in the log. Test data was removed;
`app.users`, `shelves`, `reading_sessions`, `reviews`, `work_locations` and
`fictional_worlds` were all verified back to zero audit rows.
