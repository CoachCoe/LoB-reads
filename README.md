# Life on Books

A reading tracker built on a local copy of the Open Library catalog — 6.9 million
works, rebuilt monthly from the public dumps.

The application lives in [`bookshelf/`](bookshelf/). Start there:

| Document | What it is for |
| --- | --- |
| [`bookshelf/README.md`](bookshelf/README.md) | Getting it running, the commands, the API surface |
| [`bookshelf/PRD.md`](bookshelf/PRD.md) | What it is meant to do, as numbered requirements |
| [`bookshelf/ARCHITECTURE.md`](bookshelf/ARCHITECTURE.md) | The invariants, why they exist, and what is measured |
| [`bookshelf/DEPLOYMENT.md`](bookshelf/DEPLOYMENT.md) | Getting it into Azure |
| [`bookshelf/AGENTS.md`](bookshelf/AGENTS.md) | The project invariants, in the file an agent reads first |
| [`.claude/skills/bookshelf-testing/SKILL.md`](.claude/skills/bookshelf-testing/SKILL.md) | How the tests actually work here — read before writing one |
| [`infra/main.bicep`](infra/main.bicep) | The Azure topology as a template. Never deployed; see DEPLOYMENT.md |

## Which document owns which fact

The 2026-09-08 audit found twelve blocks of material restated across
`README`/`PRD`/`ARCHITECTURE`/`DEPLOYMENT`, five of them already
drifted — including a search latency figure that was an order of magnitude out
in one copy, an ingest timing that was a baseline in one file and the current
result in two others, and a test count that two files gave differently. Every
one of those was a copy that moved while its siblings did not.

So, one owner per fact, and links rather than restatements:

| fact | owner |
| --- | --- |
| Mechanism, and the measurements behind it — why the schema, the search arms and the indexes are shaped as they are, and what they cost | `bookshelf/ARCHITECTURE.md` |
| Test counts | the suite itself — it prints them, and no document should restate them |
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
