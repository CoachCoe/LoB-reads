# The last five test gaps, and a second stale finding

Closes the 2026-09-01 deferred test list. Follows
[`2026-09-02-wrapped-tests.md`](2026-09-02-wrapped-tests.md) and
[`2026-09-02-remaining-test-gaps.md`](2026-09-02-remaining-test-gaps.md).

- **Branch:** `test/route-guards-and-clamps`, cut from `dev` at `9d8f2ea`
- **Closed:** TEST-12, TEST-13, TEST-18, TEST-19, TEST-20
- **Already closed:** TEST-11
- **Verification:** typecheck 0, lint 0, **288 unit** (was 278),
  **409 integration** (was 401), build 0. 14 mutations: 13 caught, 1 recorded
  as unreachable.
- **TEST-1 .. TEST-20 are now all closed.**

## Probe first, write second

The previous round found TEST-4 already closed after three tests had been
written for it. So this round began by applying each finding's **recorded
mutation** to the current tree and running the whole suite, before writing
anything.

| finding | recorded mutation | result |
|---|---|---|
| TEST-11 | delete the coordinates-required guard | **already covered** — 2 tests fail |
| TEST-12 | `workCount` → `works.length` | gap is real |
| TEST-13 (map upload) | skip `validateImageFile` | gap is real |
| TEST-13 (avatar) | skip `validateImageFile` | **already covered** — 1 test fails |
| TEST-18 | `retryAfterSeconds` → `1` | gap is real |
| TEST-19 | remove the year clamp | gap is real |

Two of six were already closed, and TEST-13 was half closed — the avatar route
had been covered, the fictional-world upload route had not. `location-authorization.test.ts`
even says in its own header that TEST-11 is handled there, which is worth
noting: the deferred list drifts, and the code is the thing to ask.

Ten minutes of probing replaced an unknown amount of redundant test-writing.
It is now the first step of this kind of work, not an afterthought.

## What was actually missing

### TEST-18 — Retry-After said nothing

`retryAfterSeconds` was asserted only `> 0`, which the `Math.max(1, …)` floor
guarantees by itself, so replacing the whole expression with the constant `1`
passed. Every 429 would then advertise `Retry-After: 1` against a limit
measured in minutes — an invitation to retry immediately and forever, worse
than sending no header.

### TEST-19 — the year clamp could not be reached from a test

Four lines of inline ternary inside a server component, so exercising it meant
rendering the page, and nothing did. Extracted to `resolveWrappedYear`, which
now carries the reasoning: `Number("abc")` is NaN, which became
`new Date(NaN, 0, 1)` and answered 500 from inside a Prisma `gte`; below 1900
there are no sessions because that is where the catalog slice starts; and a
future year is always an empty report, which reads as data loss.

### TEST-12 — workCount and works.length agreed by accident

The interface comment already states the rule. The problem was that every
author fixture in the repo has a handful of works, so below
`AUTHOR_WORKS_LIMIT` the two expressions are equal and no test could
distinguish them. The fixture is now built past the cap — which is also the
shape a real author page has.

### TEST-13 — the map upload never asserted its own validation

`validateImageFile` is thoroughly covered; that the fictional-world upload
route *calls* it was not. `putObject` is asserted uncalled rather than only the
status, because a 400 returned after the write passes a status-only test while
the file sits in storage.

### TEST-20 — two percentages that could render past 100%

Both bypass `ProgressBar` and compute their own.

`currentlyReading.progress` was unclamped. `updateProgress` refuses a page past
the end, but it is not the only writer: the importer creates sessions directly
and `pageCount` is a snapshot from when the session started, so a row where
`currentPage` exceeds it is reachable and renders as "128%".

The year-progress bar hardcoded 365, so 31 December of a leap year is day 366
and reported 100.3% straight into a CSS width.

## Three of my own assertions could not fail

All three found by the mutation pass, none by reading the code back.

1. **The Retry-After test spent all three hits at one frozen instant**, which
   made `hits[0]` and `hits[hits.length - 1]` the same value — so reading the
   window from the newest hit rather than the oldest was invisible. The hits are
   now a minute apart.
2. **My own fix made a clamp unreachable.** Wrapping the year bar in
   `Math.min(100, …)` looked prudent, but with the denominator corrected to
   `elapsed + remaining` the ratio cannot exceed 1. The clamp was removed rather
   than kept: a guard no test can make fire is the unfalsifiable code these
   audits keep finding. The clamp on `currentlyReading` stays, because there the
   excess is reachable and a test proves it.
3. **A boundary test asserted a floor that cannot fire.** Removing
   `Math.max(1, …)` from the limiter changes nothing observable: hits are
   filtered to `> windowStart`, so `oldest + windowMs - now` is always
   positive. That mutation is **recorded as surviving**. The floor is
   pre-existing defensive code and was left alone — but nothing here pretends
   to cover it. The test was repointed at the window filter, which is
   reachable and now pinned from both sides.

The difference between cases 2 and 3 is deliberate: unfalsifiable code I wrote
this round came out; unfalsifiable code that was already there stayed, with the
gap written down instead of hidden.

## A mutation harness that lied about cleaning up

The first attempt ran fourteen mutations against the full suite in one command
and was killed at the ten-minute limit. The script restores each file in a
`finally`, so the tree looked clean — and the leftover-check grepped for
markers like `LIMIT 1000`.

That check cannot see a **deletion**. The killed run had removed
`requested >= 1900 && ` from `wrapped-year.ts` and the grep found nothing to
match, so the mutation was reported as restored while it was still in the
working tree. The new unit tests then failed on the next run, which is how it
surfaced — the suite catching a defect in the tooling built to test the suite.

Fixed twice over: mutations are now run against a targeted test pattern so each
takes seconds, and restoration is verified by comparing a SHA-256 of the file
against its pre-mutation hash rather than by looking for a marker.
