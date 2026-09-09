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
| [`bookshelf/AGENTS.md`](bookshelf/AGENTS.md) | The project invariants, in the file an agent reads first |
| [`.claude/skills/bookshelf-testing/SKILL.md`](.claude/skills/bookshelf-testing/SKILL.md) | How the tests actually work here — read before writing one |
| [`infra/main.bicep`](infra/main.bicep) | The Azure topology as a template. Never deployed; see DEPLOYMENT.md |

## `docs/`

Audit and design records, kept because the reasoning is usually more useful than
the conclusion:

- [`docs/audit/`](docs/audit/) — dated findings and the work done against them.
  Each `*-findings.md` is written before any source changes and is not edited
  afterwards; each `*-work-completed.md` records what was fixed, what was
  deferred and why. A third kind exists: a dated topic record, written after the
  change, continuing a deferred list from an earlier `*-work-completed.md` —
  `2026-09-02-remaining-test-gaps.md`, `2026-09-02-wrapped-tests.md` and
  `2026-09-03-route-guards-and-clamps.md` are those. The convention is widened
  here to describe what happened rather than renaming three files to fit a
  convention they never followed.
- [`docs/design/`](docs/design/) — the UI/UX review brief and its outcome.

## Which document owns which fact

The 2026-09-08 audit found twelve blocks of material restated across
`README`/`PRD`/`ARCHITECTURE`/`STATUS`/`DEPLOYMENT`, five of them already
drifted — including a search latency figure that was an order of magnitude out
in one copy, an ingest timing that was a baseline in one file and the current
result in two others, and a test count that two files gave differently. Every
one of those was a copy that moved while its siblings did not.

So, one owner per fact, and links rather than restatements:

| fact | owner |
| --- | --- |
| Measured numbers — latency, ingest timings, row counts, test counts | `bookshelf/STATUS.md` |
| Mechanism — why the schema, the search arms and the indexes are shaped as they are | `bookshelf/ARCHITECTURE.md` |
| Azure procedure and topology | `bookshelf/DEPLOYMENT.md` |
| What to build next, and why | `bookshelf/PRD.md` |
| The invariants, and their guards | `bookshelf/AGENTS.md` |
| How many checks `deploy:verify` runs | `deploy:verify` itself — it prints its own totals, and no document should restate them |

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
   import it.** Every `src/server/*` module imports `@/lib/prisma`, which
   constructs a PrismaClient at module scope — so a client component importing
   any of them ships Prisma to the browser, where `Prisma.sql` throws on
   evaluation. Guarded by `__tests__/conventions.test.ts`, which forbids a
   client component value-importing `src/server/*` **or** `@/lib/prisma`.
