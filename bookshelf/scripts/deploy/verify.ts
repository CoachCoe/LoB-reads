/**
 * Verify a deployment, rather than trusting it.
 *
 *   DIRECT_URL=… DATABASE_URL=… npm run deploy:verify
 *   DIRECT_URL=… BASE_URL=https://app.example.com npm run deploy:verify
 *
 * Every check here corresponds to something that has actually gone wrong, or
 * that would fail silently if it went wrong. The pattern this project keeps
 * hitting is a deployment that looks healthy and is not: a container that
 * builds, starts, serves static pages and 500s on every query; GIN indexes
 * dropped by a migration with no failing test; storage that accepts uploads and
 * serves 403; a `work_mem` default that makes search 3.5x slower.
 *
 * Exits non-zero if any check fails, so it can gate a release.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

type Result = {
  name: string;
  ok: boolean;
  detail: string;
  fatal: boolean;
  /** Shown only when the check fails. Explains why it matters and what to do. */
  hint?: string;
};
const results: Result[] = [];

function check(
  name: string,
  ok: boolean,
  detail = "",
  opts: { fatal?: boolean; hint?: string } = {}
) {
  results.push({
    name,
    ok,
    detail,
    fatal: opts.fatal ?? true,
    hint: opts.hint,
  });
}

/** Parses Postgres memory settings ('32MB', '4096kB') into kilobytes. */
function toKb(setting: string): number {
  const match = setting.trim().match(/^(\d+)\s*([kMG]B)?$/);
  if (!match) return NaN;
  const value = Number(match[1]);
  switch (match[2]) {
    case "GB":
      return value * 1024 * 1024;
    case "MB":
      return value * 1024;
    case "kB":
    case undefined:
      return value; // bare numbers are blocks for some GUCs, but not for these
    default:
      return NaN;
  }
}

async function checkDatabase(url: string, label: string) {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch (error) {
    check(`${label}: reachable`, false, (error as Error).message);
    return null;
  }
  check(`${label}: reachable`, true);
  return client;
}

async function main() {
  // --- configuration -------------------------------------------------------

  const direct = process.env.DIRECT_URL;
  const pooled = process.env.DATABASE_URL;
  const baseUrl = process.env.BASE_URL?.replace(/\/$/, "");

  if (!direct) {
    process.stderr.write("DIRECT_URL is required.\n");
    process.exit(2);
  }

  check("NEXTAUTH_SECRET is set", Boolean(process.env.NEXTAUTH_SECRET));
  check(
    "NEXTAUTH_SECRET is not a placeholder",
    !/placeholder|changeme|secret-not-for-deployment/i.test(
      process.env.NEXTAUTH_SECRET ?? ""
    ),
    "",
    { hint: "every session token is forgeable with a known secret" }
  );
  check(
    "NEXTAUTH_URL is not localhost",
    !/localhost|127\.0\.0\.1/.test(process.env.NEXTAUTH_URL ?? "localhost"),
    process.env.NEXTAUTH_URL ?? "unset"
  );

  // A pooled URL without the flag breaks prepared statements under reuse; a
  // direct URL carrying it means the two got swapped.
  if (pooled) {
    const poolsAreDistinct = pooled !== direct;
    check(
      "DATABASE_URL and DIRECT_URL differ",
      poolsAreDistinct,
      poolsAreDistinct ? "" : "both point at the same endpoint",
      // Fine on a single instance with no pooler, so a warning not a failure.
      { fatal: false, hint: "expected if no pooler is in front of Postgres" }
    );
    if (/:6432\b|pgbouncer/i.test(pooled)) {
      check(
        "pooled URL carries pgbouncer=true",
        /pgbouncer=true/.test(pooled),
        "",
        {
          hint: "in transaction pooling mode Prisma's prepared statements break under connection reuse without it",
        }
      );
    }
  }
  check("DIRECT_URL is not pooled", !/pgbouncer=true/.test(direct), "", {
    hint: "migrations take advisory locks and run DDL; neither survives a transaction pooler",
  });

  check(
    "storage can serve what it stores",
    Boolean(process.env.CDN_URL) ||
      process.env.AZURE_STORAGE_PUBLIC_CONTAINER === "true",
    "",
    {
      hint: "set CDN_URL — a private container with no CDN accepts uploads and then returns 403 for every image",
    }
  );

  // --- database ------------------------------------------------------------

  const client = await checkDatabase(direct, "direct connection");
  if (!client) return;

  if (pooled && pooled !== direct) {
    const poolClient = await checkDatabase(pooled, "pooled connection");
    await poolClient?.end();
  }

  const one = async (sql: string): Promise<string | null> => {
    const { rows } = await client.query(sql);
    return rows[0] ? String(Object.values(rows[0])[0]) : null;
  };

  // Extensions. Search silently falls back to sequential scans without these.
  const extensions = (await client.query(
    "SELECT extname FROM pg_extension"
  )).rows.map((r) => r.extname as string);
  for (const required of ["pg_trgm", "unaccent"]) {
    check(`extension ${required}`, extensions.includes(required));
  }

  // Migrations. Compares what is on disk to what the database recorded, which
  // catches a deployment that shipped code ahead of its schema.
  const onDisk = readdirSync(path.join(process.cwd(), "prisma/migrations"), {
    withFileTypes: true,
  }).filter((e) => e.isDirectory() && /^\d/.test(e.name)).length;

  const applied = Number(
    await one(
      "SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"
    )
  );
  check(
    "all migrations applied",
    applied === onDisk,
    `${applied} applied, ${onDisk} on disk`
  );

  const failed = Number(
    await one(
      "SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL"
    )
  );
  check("no failed migrations", failed === 0, `${failed} incomplete`);

  // work_mem. The migration sets this at database scope, but a managed provider
  // may refuse ALTER DATABASE — in which case it warns and carries on, so this
  // is the check that catches it.
  const workMem = (await one("SELECT current_setting('work_mem')")) ?? "";
  const workMemKb = toKb(workMem);
  check("work_mem is at least 32MB", workMemKb >= 32 * 1024, workMem, {
    hint: "the default makes the search bitmap scan go lossy and recheck ~1M rows, roughly 3.5x slower. Set it as a server parameter if the migration could not.",
  });

  const threshold = await one(
    "SELECT current_setting('pg_trgm.similarity_threshold')"
  );
  check(
    "pg_trgm.similarity_threshold is configured",
    Number(threshold) > 0.3,
    String(threshold),
    { fatal: false, hint: "fuzzy matching will be looser than intended" }
  );

  // Catalog contents. A restore that silently did nothing leaves every search
  // empty while the app looks fine.
  const works = Number(await one("SELECT count(*) FROM catalog.works"));
  check("catalog has works", works > 0, works.toLocaleString());

  const editions = Number(await one("SELECT count(*) FROM catalog.editions"));
  check("catalog has editions", editions > 0, editions.toLocaleString());

  // The search indexes. Three of these were once generated away by a
  // `prisma migrate diff` and search ran unindexed for three milestones without
  // a single failing test.
  const indexes = (await client.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'catalog'"
  )).rows.map((r) => r.indexname as string);

  for (const required of [
    "works_search_vector_idx",
    "works_title_norm_idx",
    "works_author_names_norm_idx",
    "works_subjects_idx",
  ]) {
    check(`index ${required}`, indexes.includes(required));
  }

  // The trigger that maintains search_vector. Not copied by every restore
  // method, and without it new rows are unsearchable.
  const trigger = await one(
    "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'catalog' AND t.tgname = 'works_search_vector_trigger' AND NOT t.tgisinternal"
  );
  check("search_vector trigger exists", Number(trigger) === 1);

  // Statistics. A dump carries none, so a freshly restored catalog plans blind
  // until someone runs ANALYZE.
  const unanalyzed = (await client.query(
    `SELECT relname FROM pg_stat_user_tables
      WHERE schemaname = 'catalog' AND n_live_tup > 1000
        AND last_analyze IS NULL AND last_autoanalyze IS NULL`
  )).rows.map((r) => r.relname as string);
  check(
    "statistics have been gathered",
    unanalyzed.length === 0,
    unanalyzed.length ? `never analyzed: ${unanalyzed.join(", ")}` : ""
  );

  await client.end();

  // --- the running app -----------------------------------------------------

  if (!baseUrl) {
    check("HTTP checks", true, "skipped — set BASE_URL to check the running app", {
      fatal: false,
    });
  } else {
    const get = async (p: string) => {
      try {
        const res = await fetch(`${baseUrl}${p}`, { redirect: "manual" });
        return res;
      } catch (error) {
        check(`GET ${p}`, false, (error as Error).message);
        return null;
      }
    };

    const live = await get("/api/health");
    if (live) check("liveness probe returns 200", live.status === 200, `HTTP ${live.status}`);

    const ready = await get("/api/health/ready");
    if (ready) {
      check(
        "readiness probe returns 200",
        ready.status === 200,
        `HTTP ${ready.status}`
      );
    }

    // The CSP is baked in at build time, so a stale or missing CDN_URL shows up
    // here as an img-src that will block every uploaded image.
    const home = await get("/");
    if (home) {
      const csp = home.headers.get("content-security-policy") ?? "";
      check("CSP header is present", csp.length > 0);

      if (process.env.CDN_URL) {
        const origin = new URL(process.env.CDN_URL).origin;
        check("CSP img-src includes the CDN origin", csp.includes(origin), origin, {
          hint: "uploaded images will be blocked in the browser; the build needs CDN_URL set",
        });
      }
      check(
        "CSP does not reference localhost",
        !/localhost|127\.0\.0\.1/.test(csp),
        "",
        { hint: "the image was built with a development CDN_URL baked in" }
      );
      check(
        "HSTS header is present",
        Boolean(home.headers.get("strict-transport-security")),
        "",
        { fatal: false }
      );
    }

    // Search has to be indexed AND fast. An unindexed catalog still returns
    // results, just slowly, so correctness alone would pass.
    const started = Date.now();
    const search = await get("/search?q=dune");
    const elapsed = Date.now() - started;
    if (search) {
      check("search responds", search.status === 200, `HTTP ${search.status}`);
      check(
        "search is under a second",
        elapsed < 1000,
        `${elapsed}ms`,
        {
          hint: "if this is seconds rather than milliseconds, the catalog restored without its indexes",
        }
      );
    }
  }
}

main()
  .then(() => {
    const width = Math.max(...results.map((r) => r.name.length));
    for (const { name, ok, detail, fatal, hint } of results) {
      const mark = ok ? " ok " : fatal ? "FAIL" : "warn";
      process.stdout.write(
        `  ${mark}  ${name.padEnd(width)}${detail ? `  ${detail}` : ""}\n`
      );
      // Only failures get the explanation; a passing check that prints why it
      // would matter reads like a finding.
      if (!ok && hint) process.stdout.write(`        ${hint}\n`);
    }

    const failures = results.filter((r) => !r.ok && r.fatal);
    const warnings = results.filter((r) => !r.ok && !r.fatal);
    process.stdout.write(
      `\n  ${results.length - failures.length - warnings.length}/${results.length} passed` +
        (warnings.length ? `, ${warnings.length} warning(s)` : "") +
        (failures.length ? `, ${failures.length} FAILED` : "") +
        "\n"
    );
    process.exit(failures.length > 0 ? 1 : 0);
  })
  .catch((error) => {
    process.stderr.write(`\nverify threw: ${error.message}\n`);
    process.exit(2);
  });
