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
 *
 * Deliberately does NOT load `.env`, unlike the storage smoke test. This
 * verifies a *deployment*, so its configuration must come from the environment
 * it is handed. Reading a local `.env` would let it cheerfully report a
 * developer's own database as a healthy production one — the same trap
 * `scripts/db/migrate-deploy.sh` exists to avoid.
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

  // A placeholder is a VALUE, not a substring. The check used to be
  // /placeholder|changeme|.../i over the whole secret, which rejected CI's own
  // deliberately-real `${{ github.sha }}-not-a-placeholder` because that string
  // contains "placeholder" — so this gate failed every run and CI was red at the
  // last step. Compare against known placeholder values instead, and let length
  // carry the real protection: a short secret is the actual risk, and substring
  // matching never caught one.
  const secret = (process.env.NEXTAUTH_SECRET ?? "").trim();
  const KNOWN_PLACEHOLDERS = [
    "changeme",
    "ci-placeholder-secret",
    "ci-secret",
    "placeholder",
    "secret",
    "secret-not-for-deployment",
  ];
  check(
    "NEXTAUTH_SECRET is not a known placeholder",
    secret.length > 0 && !KNOWN_PLACEHOLDERS.includes(secret.toLowerCase()),
    "",
    { hint: "every session token is forgeable with a known secret" }
  );
  check(
    "NEXTAUTH_SECRET is long enough",
    secret.length >= 32,
    secret.length > 0 ? `${secret.length} characters` : "unset",
    {
      hint: "`openssl rand -base64 32` produces 44; anything short is guessable",
    }
  );
  check(
    "NEXTAUTH_URL is not localhost",
    !/localhost|127\.0\.0\.1/.test(process.env.NEXTAUTH_URL ?? "localhost"),
    process.env.NEXTAUTH_URL ?? "unset"
  );
  // NextAuth derives cookie security from this URL's scheme: with no explicit
  // `useSecureCookies` (and options.ts sets none), an http:// base yields a
  // session cookie with secure=false and no __Secure- prefix — sent in cleartext
  // on any downgrade. The gate checked "not localhost", which an http://
  // production host passes happily.
  check(
    "NEXTAUTH_URL is https",
    (process.env.NEXTAUTH_URL ?? "").startsWith("https://"),
    process.env.NEXTAUTH_URL ?? "unset",
    { hint: "an http URL makes NextAuth drop Secure from the session cookie" }
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

  // DISTINCT matters: a migration that failed once and was then re-applied has
  // several rows, only one of which succeeded.
  const applied = Number(
    await one(
      `SELECT count(DISTINCT migration_name) FROM public._prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
    )
  );
  check(
    "all migrations applied",
    applied === onDisk,
    `${applied} applied, ${onDisk} on disk`
  );

  // A rolled-back row is only a problem if that migration has no successful
  // row at all. Treating any rolled-back attempt as a failure flags the normal
  // `migrate resolve --rolled-back` recovery, which is history, not breakage —
  // this check did exactly that against a database `migrate status` called
  // up to date.
  const stuck = (await client.query(
    `SELECT DISTINCT migration_name FROM public._prisma_migrations m
      WHERE NOT EXISTS (
        SELECT 1 FROM public._prisma_migrations ok
         WHERE ok.migration_name = m.migration_name
           AND ok.finished_at IS NOT NULL
           AND ok.rolled_back_at IS NULL
      )`
  )).rows.map((r) => r.migration_name as string);

  check(
    "no migration left unapplied after a failure",
    stuck.length === 0,
    stuck.length ? stuck.join(", ") : ""
  );

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

  // Rate limiting is only a control if a client can be told apart.
  //
  // SEC-3: with no platform header configured and no trusted proxy hops, every
  // request is unidentified — so the per-IP limits do not apply at all, and
  // login:ip / register are simply absent. That is a silent condition: the app
  // starts, serves, and looks healthy. It also removes the premise that made the
  // registration enumeration oracle an acceptable trade (OQ-6), whose recorded
  // reasoning ends "what made the trade acceptable is that the 5/hour cap above
  // is now real".
  //
  // Read from the environment rather than imported, because this script runs
  // against a deployed configuration rather than inside the app.
  const trustedHeader = process.env.TRUSTED_CLIENT_IP_HEADER?.trim();
  const hopsRaw = process.env.TRUSTED_PROXY_HOPS?.trim();
  const hops = Number(hopsRaw ?? "1");
  const canIdentify = Boolean(trustedHeader) || (Number.isInteger(hops) && hops > 0);
  check(
    "a client can be identified for rate limiting",
    canIdentify,
    canIdentify
      ? trustedHeader
        ? `via ${trustedHeader}`
        : `via ${hops} trusted proxy hop(s)`
      : "set TRUSTED_CLIENT_IP_HEADER (x-azure-clientip behind Front Door, with direct ingress blocked) or TRUSTED_PROXY_HOPS > 0 — otherwise the per-IP limits silently do not apply"
  );

  // And the hop count must be chosen, not inherited.
  //
  // The default of 1 is wrong for the topology DEPLOYMENT.md documents: Front
  // Door in front of Container Apps is two appending hops. A count below the
  // real chain returns a proxy's own egress address, which is identical for
  // every client on the internet, so ten sign-in attempts refuse sign-in to
  // everyone.
  const explicit = Boolean(trustedHeader) || hopsRaw !== undefined;
  check(
    "the client-IP strategy is explicit",
    explicit,
    explicit
      ? ""
      : "TRUSTED_PROXY_HOPS is unset and defaulting to 1; behind Front Door -> Container Apps the real chain is 2, and guessing low puts every client on one bucket"
  );

  // The in-memory limiter only holds on one replica.
  //
  // DEPLOYMENT.md documents this and names the mitigation — "pin the app to one
  // replica, or move the limiter to a shared store" — and nothing enforced it,
  // so effective limits become limit x replicas and Container Apps adds replicas
  // under exactly the load an attacker generates (SEC-8).
  const maxReplicas = process.env.MAX_REPLICAS?.trim();
  const replicasOk = maxReplicas === "1" || Boolean(process.env.RATE_LIMIT_STORE_URL);
  check(
    "the rate limiter's replica assumption holds",
    replicasOk,
    replicasOk
      ? process.env.RATE_LIMIT_STORE_URL
        ? "shared store configured"
        : "pinned to one replica"
      : "the limiter is per-process: set MAX_REPLICAS=1 to record that the revision is pinned, or RATE_LIMIT_STORE_URL once a shared store exists"
  );

  // No foreign key from app into catalog.
  //
  // ARCHITECTURE.md calls this the single most load-bearing decision in the
  // schema, and until now nothing enforced it. The integration suite covers the
  // schema Prisma generates; this covers the database that actually shipped,
  // which is not the same claim — a hand-written migration or a restore from a
  // dump made elsewhere can carry a constraint Prisma never saw, and a release
  // is exactly when that difference surfaces.
  const crossSchemaFks = (await client.query(
    `SELECT c.conname, rn.nspname || '.' || r.relname AS from_table
       FROM pg_constraint c
       JOIN pg_class     r  ON r.oid  = c.conrelid
       JOIN pg_namespace rn ON rn.oid = r.relnamespace
       JOIN pg_class     f  ON f.oid  = c.confrelid
       JOIN pg_namespace fn ON fn.oid = f.relnamespace
      WHERE c.contype = 'f' AND rn.nspname = 'app' AND fn.nspname IN ('catalog', 'seed')`
  )).rows.map((r) => `${r.from_table} (${r.conname})`);
  check(
    "no foreign key from app into catalog",
    crossSchemaFks.length === 0,
    crossSchemaFks.length ? `found: ${crossSchemaFks.join(", ")}` : ""
  );

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
