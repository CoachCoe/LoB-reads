# Six more test gaps closed, and one that was already closed

Continues [`2026-09-02-wrapped-tests.md`](2026-09-02-wrapped-tests.md) through
the rest of the 2026-09-01 deferred test list.

- **Branch:** `test/remaining-gaps`, stacked on `test/wrapped-coverage`
- **Closed:** TEST-5, TEST-7, TEST-8, TEST-14, TEST-15, TEST-16, plus ORG-19
- **Already closed:** TEST-4 — see below
- **Still open:** TEST-11, TEST-12, TEST-13, TEST-18, TEST-19, TEST-20
- **Verification:** typecheck 0, lint 0, **276 unit** (was 273),
  **401 integration** (was 392), build 0. 13 mutations applied one at a time:
  13 caught.

## TEST-4 was already closed, and the deferred list is stale

The finding records the mutation as "move `Math.min(3600, …)` back inside the
computed branch", surviving because the only caller-supplied case in the suite
was `recordFailure(…, 3600)` and `Math.min(3600, 3600) === 3600`.

That is no longer true. `enrichment.test.ts:151` — "caps a backoff the upstream
asked for", added in a later round under the label SEC-15 — calls
`recordFailure(job.id, 0, "rate limited", 999_999_999)` and bounds
`nextAttemptAt` at an hour. Applying the audit's mutation fails it. Replacing
the ceiling with the constant `3600` fails the neighbouring jitter test.

Three tests were written for TEST-4 before this was checked, and all three were
then **deleted rather than kept**: each was caught only alongside a
pre-existing test, so they added assertions without adding discrimination. A
redundant test is not free — it is another thing to read and to keep true.

## The four groups that were real

### TEST-15 and TEST-16 — the catalog leaked between files

`clearTestCatalogRows` deleted by an `OLT` prefix, on the assumption that
factory rows were the only catalog rows a suite created. They are not: the
search suite alone writes `OLPAG%` and `OLPOP%` keys plus its own fixture
prefix, each removed by its own hand-rolled DELETE, and `subject_counts` was
known to no helper at all.

`health.test.ts` is where that lands. Two of its tests assert an empty catalog,
and they passed only because every alphabetically-earlier catalog-writing file
happened to tidy up after itself. Demonstrated rather than argued: seeding one
`catalog.works` row under an unrecognised prefix fails both of them. It now
empties the catalog in its own `beforeEach`.

The helper deletes every catalog table unconditionally, in foreign-key order —
the schema has exactly three FKs, all within `catalog` — and the table list is
enumerated for the same reason as `APP_TABLES`.

**DELETE rather than TRUNCATE, and that is measured.** TRUNCATE rewrites and
fsyncs each relation's file; across these fourteen tables it cost 3-5 seconds
per call and took `health.test.ts` from 0.97s to 23s. Unconditional DELETE over
a few thousand fixture rows is milliseconds, and dropping the LIKE scans took
the **whole integration suite from 71s to 41s**.

This is the mechanism the previous round recorded under "one thing I could not
reproduce": one integration run reported two failures where every file passed
in isolation. That note can now be closed as explained, though not as
reproduced — the failing test names were never captured.

### TEST-7 and TEST-8 — the page ceiling and the last page

Both one character wide, in `updateProgress`, and both matter more since
FLOW-28 made the session's `pageCount` the single source of truth for the
progress UI.

Every existing progress test posts 120 or -1 against a 412-page book, so
deleting the `currentPage > session.pageCount` ceiling changed nothing: page
5,000 was accepted. And every test reached "finished" through `action:
"finish"`, so weakening `currentPage >= session.pageCount` to `>` left both the
documented "reaching the last page finishes the book" and the shelf move it
drives unguarded.

The boundary is asserted from **both sides** — 411 does not finish, 412 does —
because a test proving only "a big page number finishes it" is equally happy
with `>`, with `>= pageCount - 1`, and with no comparison at all. All three
fail now, as do dropping the shelf move and dropping the null-`pageCount`
exclusion.

### TEST-14 — provenance has to be disagreed with one field at a time

"Refuses to resume across a republication" changes both `etag` and
`lastModified`, so weakening `describesSameObject`'s conjunction to a
disjunction left two falses and the same answer. Each field is now disagreed
with alone, which is also what a real re-upload looks like: a dump rebuilt
within the same second, or a weak ETag reused across a republication.

### TEST-5 — LIKE metacharacters in an imported author name

`findWorkKeyByTitleAuthor` escapes them and had no test by any path. Binding
the author stops injection and does nothing about `%` and `_`. It matters
because `imports.ts:153` feeds this straight to `applyRow` and marks the row
`matched`/`title_author` with **no review**, so a crafted row attaches to
whichever work shares its title and has the most editions.

`_` is the case a `%`-only test misses: it matches exactly one character, so an
author of `Frank Herber_` wildcard-matches `Frank Herbert` while looking like
an ordinary typo.

The backslash branch needed a different shape of test, and working out why is
the useful part. A crafted `\_` **cannot** produce a false match: whatever the
leftover backslash does to the character after it, the pattern still demands a
literal backslash that no ordinary name contains. Its real effect is the
opposite — a false negative. Unescaped, `%AC\DC%` collapses to `%ACDC%` and
stops matching the very name it was built from. Confirmed in Postgres directly
before relying on it, then asserted by seeding an author whose name contains a
backslash.

A control case — the author the row actually names still matches — keeps the
other three honest. Without it, all of them would pass if title-and-author
matching stopped working altogether.

## Mutation results

13 mutations, applied one at a time, source restored between. All 13 caught.

| mutation | caught by |
|---|---|
| page ceiling deleted | "refuses a page beyond the edition's length" |
| ceiling tightened to `>=` | "accepts the last page itself" (+1) |
| `>=` weakened to `>` | "finishes the book on reaching the last page" |
| finish one page early (`>= pageCount - 1`) | "does not finish one page short of the end" |
| null `pageCount` no longer excluded | "leaves a session with no page count open" |
| shelf move dropped | "finishes the book … and moves it to Read" |
| conjunction weakened to disjunction | all three new resume cases |
| `etag` comparison dropped | the etag-only case (+1) |
| `lastModified` comparison dropped | the lastModified-only case |
| LIKE escape dropped entirely | three of the four import cases |
| only `%` escaped | the underscore case (+1) |
| only `_` escaped | the percent case (+1) |
| backslash left unescaped | the backslash-in-name case only |

The last row is why that case was rewritten. Its first version asserted correct
behaviour and could not fail.

## Not done

TEST-11 (the coordinates-required guard on the work-locations route),
TEST-12 (`workCount` falling back to a capped `works.length`), TEST-13 (neither
upload route asserted to call `validateImageFile`), TEST-18
(`retryAfterSeconds` asserted only `> 0`), TEST-19 (the `/wrapped?year=` clamp)
and TEST-20 (two unclamped percentage renders) are untouched and remain on the
deferred list.
