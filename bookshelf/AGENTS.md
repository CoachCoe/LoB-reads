<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project invariants

Below the vendor block, and not written by `next dev`. Each of these has a test
that fails if it is broken, and each was broken at least once first.

- **All database access lives in `src/server`.** A client component that imports
  from there ships Prisma to the browser — `src/server/catalog.ts` constructs a
  PrismaClient at module scope and `Prisma.sql` throws on evaluation in a browser.
  This shipped once and no build or test noticed. Guarded by
  `__tests__/conventions.test.ts`.
- **Nothing in `app` may hold a foreign key into `catalog`.** The catalog is
  dropped and rebuilt from Open Library dumps monthly. Prisma's own docs will
  suggest adding the relation; do not. Guarded by
  `__tests__/integration/schema-invariants.test.ts` and by `deploy:verify`.
- **Integration tests share one database and must run serially.** `--runInBand`
  is enforced in the npm script and in CI. In parallel they deadlock and violate
  foreign keys, intermittently.
- **Read paths tolerate a missing work.** An ingest can narrow the slice and drop
  a work someone has shelved; those render as "not in the current catalog" and
  are not linked, because the work page 404s on a key the current slice lacks.
- **Comparisons go against the `_norm` columns**, never `unaccent(lower(col))`.
  Wrapping the column turned the fuzzy search path into a sequential scan over
  6.9M rows once already.
