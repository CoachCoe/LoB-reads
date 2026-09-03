---
name: bookshelf-testing
description: How tests actually work in this repo — Jest 30 with two projects, integration against a real Postgres, and the mutation-testing discipline the audits established. Load this BEFORE writing or changing any test here, in place of the generic testing-patterns skill, which describes Vitest and a tests/unit layout that this repo does not use.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Testing in this repo

**Jest 30, not Vitest.** There is no `vi`, no `vitest.config`, and no
`tests/unit/` directory. A generic testing skill will tell you otherwise; it is
describing a different stack. Everything below was read off `jest.config.ts`,
`package.json` and the suites themselves.

## Layout and commands

| | |
|---|---|
| unit | `bookshelf/__tests__/**/*.test.ts?(x)`, jsdom, no I/O — `npm test` |
| integration | `bookshelf/__tests__/integration/*.test.ts`, node, real Postgres — `npm run test:integration` |
| both | `npm run test:all` |
| one file | `npm run test:integration -- wrapped` (Jest takes a path *pattern*) |
| the rest of the gate | `npx tsc --noEmit`, `npm run lint`, `npm run build` |

All commands run from `bookshelf/`, not the repo root — `ci.yml` sets
`working-directory: bookshelf` for the same reason.

Those five are the local gate; green on all five is the minimum before opening
a PR. CI runs more: `prisma migrate deploy` and `migrate status` against an
empty Postgres 16, `db:seed`, `ingest -- --fixture`, `deploy:verify`, and a
separate job that builds and boots the container. So a change to migrations,
the ingest scripts or the release checks can be green locally and red in CI —
read `.github/workflows/ci.yml` rather than assuming the local five cover it.

## Integration tests

They talk to a real database on purpose. The behaviour under test is usually a
query or a constraint, and a mocked client only asserts that the mock returned
what it was told to.

- `TEST_DATABASE_URL` must be set, and `__tests__/integration/env.ts` refuses
  any database whose name lacks "test", because these tests TRUNCATE.
- `setup.ts` truncates every `app.*` table in a global `beforeEach`, so each
  test starts clean. Catalog rows are *not* truncated per test — the search
  suite seeds thousands once — and are removed by the `OLT` prefix in
  `afterAll`. A new `app` table must be added to `APP_TABLES` by hand; the list
  is explicit so an omission is visible.
- Build fixtures with `factories.ts` (`makeUser`, `makeUserWithShelves`,
  `makeWork`, `makeShelf`, …) rather than inline `prisma.create` calls.
- **They must run serially.** `--runInBand` is in the npm script and in CI. In
  parallel they deadlock and violate foreign keys, intermittently.

## The discipline that matters here

This repo has shipped four blockers past a fully green suite. Every one got
through because a test existed and could not fail. So:

**Mutation-test every assertion you write.** Change the source so the
behaviour is wrong, confirm the test fails, put the source back. If it still
passes, the assertion is decoration. Three real examples, all fixed:

- `TEST-6` compared returned counts against *their own* descending sort, and
  the fixture's counts were all equal — which any order satisfies.
- `TEST-17`'s only pagination test searched for `"the"`, an English stopword,
  so both pages were empty and it asserted `[] === []`.
- `TEST-9` had no test at all, and dropping `finishedAt: { not: null }`
  counted in-progress books as read on two pages.

Practical consequences:

- **Use distinct values, never ties.** Ranking asserted over equal counts
  proves nothing.
- **Watch for one guard masking another.** A `>= 4` filter and a five-item cap
  in the same case can be indistinguishable; assert each where the other
  cannot stand in for it.
- **Assert numbers, not shapes.** `expect(x).toBeDefined()` and
  `rejects.toBeInstanceOf(Error)` are satisfied by almost anything.
- **Assert query plans, not latency.** `read-path-plans.test.ts` asks "does
  this read the whole table?", which gives the same answer at 3,000 rows as at
  6.9M. A p95 threshold passes on fixtures and hides a sequential scan.
- **Route tests must assert state as well as status.** A 403 returned *after*
  the write passes a status-only check. Three authorization holes survived 534
  tests because the tests called the server function and passed the flag
  themselves instead of exercising the route.

## Gotchas that have cost time

- **Faking time:** fake `Date` only. Pass every timer API in `doNotFake` to
  `jest.useFakeTimers()` — the Postgres driver schedules real work on them and
  wedges otherwise. See `wrapped.test.ts`.
- **Timezones:** CI runs in UTC, the development machine does not. Code that
  mixes `new Date(y, m, d)` (local) with millisecond arithmetic will land on a
  different day in each. Put fixture times at **midday**, which absorbs both
  the offset and any DST transition in the interval.
- **`bigint` columns** must be cast (`::int`) or `JSON.stringify` refuses them.
  That was a 500 no test read.
- **Client/server boundary:** `conventions.test.ts` forbids a client component
  value-importing `src/server/*` or `@/lib/prisma`, and asserts every
  `/api/...` literal resolves to a route that exports the method named. Do not
  work around it — it exists because components once called routes that had
  moved and 404'd silently for three milestones.
- **Don't mock internal modules** to avoid a database. Either it is a pure
  function and belongs in the unit project, or the database *is* the thing
  under test.

## Where the record lives

`docs/audit/*.md` records what each round found, fixed and deferred, including
the mutations that survived. `bookshelf/AGENTS.md` holds the project
invariants, each of which has a test and each of which was broken once first.
