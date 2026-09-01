# Life on Books

A reading tracker built on a local copy of the Open Library catalog — 6.9 million
works, rebuilt monthly from the public dumps.

The application lives in [`bookshelf/`](bookshelf/). Start there:

| Document | What it is for |
| --- | --- |
| [`bookshelf/README.md`](bookshelf/README.md) | Getting it running, the commands, the API surface |
| [`bookshelf/PRD.md`](bookshelf/PRD.md) | What it is meant to do, as numbered requirements |
| [`bookshelf/ARCHITECTURE.md`](bookshelf/ARCHITECTURE.md) | The invariants and why they exist |
| [`bookshelf/STATUS.md`](bookshelf/STATUS.md) | What is measured, and what is known to be missing |
| [`bookshelf/DEPLOYMENT.md`](bookshelf/DEPLOYMENT.md) | Getting it into Azure |

## `docs/`

Audit and design records, kept because the reasoning is usually more useful than
the conclusion:

- [`docs/audit/`](docs/audit/) — dated findings and the work done against them.
  Each `*-findings.md` is written before any source changes and is not edited
  afterwards; each `*-work-completed.md` records what was fixed, what was
  deferred and why.
- [`docs/design/`](docs/design/) — the UI/UX review brief and its outcome.

## The three things most likely to trip you up

These are invariants, not preferences. Each has a test that fails if it is
broken, and each was broken at least once first.

1. **Nothing in `app` may hold a foreign key into `catalog`.** The catalog is
   dropped and rebuilt monthly; a reference from user data would cascade into it.
   Guarded by `__tests__/integration/schema-invariants.test.ts` and by
   `deploy:verify`.
2. **Integration tests share one database and run serially.** `--runInBand` is
   not optional — in parallel they deadlock and violate constraints
   intermittently.
3. **All database access lives in `src/server`, and client components may not
   import it.** `src/server/catalog.ts` constructs a PrismaClient at module
   scope, so a client component importing it ships Prisma to the browser, where
   `Prisma.sql` throws on evaluation. Guarded by
   `__tests__/conventions.test.ts`.
