# TEST-10 — `wrapped.ts` under test, and two defects it exposed

Closes the largest single test gap recorded in
[`2026-09-01-work-completed.md`](2026-09-01-work-completed.md): `src/server/wrapped.ts`
was 387 lines with no test by any path, behind two user-facing pages
(`/wrapped`, `/wrapped/projections`).

- **Branch:** `test/wrapped-coverage`, cut from `main` at `b7e49ad`
- **Added:** 38 integration tests in `__tests__/integration/wrapped.test.ts`
- **Defects found:** 2, both fixed here
- **Verification:** typecheck 0, lint 0, **273 unit**, **392 integration**
  (was 354), build 0. 28 mutations applied one at a time: 28 caught.

## Baseline

`main` at `b7e49ad` was green on all five commands before any change: 273 unit,
354 integration. Both defects below were therefore invisible to a green suite —
the fourth time that has been true in this repo.

## The two defects

**A book finished in the last second of the year belonged to no year at all.**
Every window was built as `new Date(year, 11, 31, 23, 59, 59)` — millisecond
`.000` — and compared with `lte`. Anything finished between `23:59:59.001` and
`23:59:59.999` on 31 December fell outside that year's report, and outside the
next year's too, whose lower bound is 1 January `00:00:00.000`. It is a narrow
window, but it is a silent one: the book stays on the shelf and vanishes from
the year in review, with no error anywhere. All four windows — the two in
`getWrappedStats`, and the current-year and previous-year ones in
`getWrappedProjections` — are now half-open, `gte`/`lt`.

**`favoriteAuthor` was rendered as "Unknown".** Author attribution was
`p.book?.authorNames ?? "Unknown"`, so every book the catalog could not name
went into one bucket keyed on that literal. Two such books outvoted a real
author read once, and `/wrapped` announced "Your top author was Unknown".

Both inputs to that bucket are ordinary, not hypothetical. `catalog.works.author_names`
is nullable; and an ingest can narrow the slice and drop a work someone has
already shelved, which is a case the read paths are required to tolerate —
`AGENTS.md` states the invariant. Unnameable books are now left out of the
ranking entirely, matching how genres already behaved, since an absent
`subjects` array contributes nothing. The books still count towards
`booksRead`; only the attribution is dropped. No view change was needed:
`WrappedExperience.tsx` already renders `stats.favoriteAuthor || "Many great
writers"`, a fallback that until now could not be reached.

## Mutation results

28 mutations, applied one at a time to `wrapped.ts`, suite re-run against each,
source restored between. All 28 were caught, and 24 of them by exactly one test.

The one that matters is the mutation that **survived** the first draft.
Relaxing the top-rated filter from `r.rating >= 4` to `>= 3` changed nothing,
because that case had eight reviews: the three-star book sorted last and the
five-book cap cut it regardless. The cap was standing in for the filter and the
assertion could not tell them apart — TEST-6 and TEST-17 in this repo were the
same mistake, and it is the reason the mutation pass is run rather than assumed.
Split into two cases: three reviews, where the cap cannot hide the filter, and
seven, where the cap is what is being asserted. Both now fail under their
respective mutations.

Mutations worth keeping a note of, because each names a defect this module could
plausibly acquire:

| mutation | caught by |
|---|---|
| window applied to `startedAt` rather than `finishedAt` | "does not count a book still being read" — TEST-9 was this exact defect one module over |
| `getMonth()` shifted by one | "returns twelve zero-filled months indexed from zero" — the view indexes `MONTH_NAMES` with the raw value, so a one-based month mislabels every bar and drops December |
| leap rule reduced to `year % 4 === 0` | the 2100 case |
| leap rule loses `|| year % 400 === 0` | the 2000 case |
| `distinct: ["workKey"]` on the sessions query | "counts a re-read of the same book twice" — the schema declines a unique constraint on (user, work) and says why |
| progress divides by a missing page count | "reports progress through the books still open" — otherwise a `NaN` renders as "NaN%" |
| average month length 30.44 → 30 | the projection cases, which is why they assert absolute numbers rather than re-deriving the formula |

## Two notes on the tests themselves

**Only `Date` is faked.** `getWrappedProjections` takes no year argument and
reads the wall clock, so its cases pin the clock with
`jest.useFakeTimers({ doNotFake: [...] })` listing every timer API. Faking the
timer APIs as well wedges the Postgres driver, which schedules real work on
them; that was established by probe before the suite was written, not assumed.

**Fixture times are midday.** The module builds year bounds with
`new Date(year, 0, 1)` — local — while day arithmetic is in milliseconds. A
fixture at midnight lands on a different day depending on whether the runner is
in UTC or, like the development machine, `America/New_York`, and a DST
transition inside the interval moves it again. Midday absorbs both, so every
number asserted holds in either zone. CI runs in UTC and the development
machine does not, so this is load-bearing rather than tidiness.

## One fixture change, outside `wrapped.ts`

`makeWork` in `__tests__/integration/factories.ts` gained `author`, `subjects`
and `coverId` overrides, since Wrapped ranks authors and genres and renders a
cover.

Its two `ON CONFLICT` clauses were also changed from `DO NOTHING` to
`DO UPDATE`. `unique()` is only as unique as the low digits of `Date.now()` plus
a counter that restarts per test *file*, so two files can generate the same
`ol_key`; under `DO NOTHING` the second caller silently inherited the first
one's title, author and page count, and a test asserting on those would have
been reading another suite's fixture. Not a defect anyone had hit, but this
suite asserts on exactly those columns. Cleanup is still by the `OLT` prefix,
unchanged. All 23 integration suites pass with it.

## Not done

- The remaining test gaps from the 2026-09-01 list — TEST-4, TEST-5, TEST-7,
  TEST-8, TEST-11 .. TEST-16, TEST-18 .. TEST-20 — are untouched.
- `averageRating`, `longestBook`, `shortestBook`, `firstBookOfYear`,
  `mostRecentBook` and `totalReadingDays` are computed by `getWrappedStats` and
  rendered by nothing. They are now tested, because they are part of the
  module's exported contract, but whether to render or delete them is the
  product decision already recorded as RECORD AND LEAVE.
- `getWrappedProjections` reads every unfinished session for the user with no
  cap, unlike the reads SEC-2 bounded. It is a per-user read behind
  authentication rather than a public one, so it is recorded here rather than
  changed.
- Neither page was opened in a browser. The fixes change server-side values,
  not markup, and both are covered against a real Postgres; the rendered pages
  are unverified.
