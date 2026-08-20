/**
 * Runs the ingest end to end: stage -> normalize -> slice -> index.
 *
 *   npm run ingest                 # assumes dumps are already in data/raw
 *   npm run ingest -- --fixture    # build and use the test fixture instead
 *   npm run ingest -- --limit 5000 # cap rows per dump, for a quick pass
 *
 * Acquire is deliberately separate: it downloads ~12GB and should be run
 * once, on its own, not as part of every re-run.
 *
 * The whole chain is idempotent. Staging truncates, normalize truncates the
 * catalog and rebuilds it, slice deletes. Re-running from scratch converges on
 * the same result.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { psqlConnectionString } from "./db";

interface SliceConfig {
  min_publish_year: number;
  languages: string[];
  require_isbn: boolean;
  require_cover: boolean;
  require_author: boolean;
  min_editions_per_work: number;
  must_appear_in_rating_corpus: boolean;
}

/**
 * Minimal YAML reader for this one flat config file. A full YAML dependency
 * would be the only reason to add one, and the shape here is fixed.
 */
function readSliceConfig(path = "config/slice.yaml"): SliceConfig {
  const text = readFileSync(path, "utf8");
  const get = (key: string): string | undefined => {
    const match = text.match(new RegExp(`^${key}:\\s*(.+?)\\s*(?:#.*)?$`, "m"));
    return match?.[1]?.trim();
  };

  const list = (key: string): string[] => {
    const raw = get(key);
    if (!raw) return [];
    return raw
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const bool = (key: string): boolean => get(key) === "true";
  const num = (key: string, fallback: number): number => {
    const raw = get(key);
    return raw !== undefined && raw !== "" ? Number(raw) : fallback;
  };

  return {
    min_publish_year: num("min_publish_year", 0),
    languages: list("languages"),
    require_isbn: bool("require_isbn"),
    require_cover: bool("require_cover"),
    require_author: bool("require_author"),
    min_editions_per_work: num("min_editions_per_work", 1),
    must_appear_in_rating_corpus: bool("must_appear_in_rating_corpus"),
  };
}

function psql(args: string[], label: string) {
  console.log(`\n▸ ${label}`);
  execFileSync("psql", ["-q", "-v", "ON_ERROR_STOP=1", psqlConnectionString(), ...args], {
    stdio: "inherit",
  });
}

function tsx(script: string, args: string[], label: string) {
  console.log(`\n▸ ${label}`);
  execFileSync("npx", ["tsx", script, ...args], { stdio: "inherit" });
}

async function main() {
  const argv = process.argv.slice(2);
  const limitIndex = argv.indexOf("--limit");
  const limitArgs = limitIndex !== -1 ? ["--limit", argv[limitIndex + 1]] : [];

  if (argv.includes("--fixture")) {
    tsx("scripts/ingest/make-fixture.ts", [], "Building test fixture");
  }

  const slice = readSliceConfig();
  console.log("Slice config:", JSON.stringify(slice));


  tsx("scripts/ingest/02-stage.ts", limitArgs, "Stage: dumps → staging tables");

  // Between staging and normalize, because normalize is one transaction over
  // ~100 million rows: a cast that fails on a single record rolls back the
  // whole thing after tens of minutes and reports a type, not a row. The
  // 2026-07-31 dump had 933 editions with "covers": [null], which is enough.
  psql(["-f", "scripts/ingest/preflight.sql"], "Pre-flight: check staged data against normalize's casts");

  // Normalize applies the edition-level slice rules as it builds, so the same
  // variables go to both steps. Passing them in one place keeps the two from
  // drifting apart.
  const sliceVars = [
    "-v", `min_publish_year=${slice.min_publish_year}`,
    "-v", `languages={${slice.languages.join(",")}}`,
    "-v", `require_isbn=${slice.require_isbn}`,
    "-v", `require_cover=${slice.require_cover}`,
  ];

  psql(
    [...sliceVars, "-f", "scripts/ingest/03-normalize.sql"],
    "Normalize: jsonb → typed columns"
  );

  psql(
    [
      ...sliceVars,
      "-v", `require_author=${slice.require_author}`,
      "-v", `min_editions=${slice.min_editions_per_work}`,
      "-v", `must_appear_in_rating_corpus=${slice.must_appear_in_rating_corpus}`,
      "-f", "scripts/ingest/04-slice.sql",
    ],
    "Slice: apply config/slice.yaml"
  );

  psql(["-f", "scripts/ingest/05-index.sql"], "Index: analyze and drop staging");

  await report();
}

async function report() {
  const { connect } = await import("./db");
  const client = await connect();
  try {
    const { rows } = await client.query<{
      works: string; editions: string; authors: string;
      no_author: string; no_vector: string; orphan_editions: string;
    }>(`
      SELECT
        (SELECT count(*) FROM catalog.works)                                    AS works,
        (SELECT count(*) FROM catalog.editions)                                 AS editions,
        (SELECT count(*) FROM catalog.authors)                                  AS authors,
        (SELECT count(*) FROM catalog.works w WHERE NOT EXISTS
           (SELECT 1 FROM catalog.work_authors wa WHERE wa.work_key = w.ol_key)) AS no_author,
        (SELECT count(*) FROM catalog.works WHERE search_vector IS NULL)        AS no_vector,
        (SELECT count(*) FROM catalog.editions WHERE work_key IS NULL)          AS orphan_editions
    `);

    const r = rows[0];
    console.log("\n── Catalog ─────────────────────────────");
    console.log(`  works              ${Number(r.works).toLocaleString()}`);
    console.log(`  editions           ${Number(r.editions).toLocaleString()}`);
    console.log(`  authors            ${Number(r.authors).toLocaleString()}`);
    console.log("── Acceptance checks ───────────────────");
    console.log(`  works with no author     ${r.no_author}  (want 0)`);
    console.log(`  works with no search vec ${r.no_vector}  (want 0)`);
    console.log(`  editions with no work    ${r.orphan_editions}`);

    if (Number(r.no_author) > 0 || Number(r.no_vector) > 0) {
      console.log("\n  Acceptance NOT met.");
      process.exitCode = 1;
    } else {
      console.log("\n  Acceptance met.");
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("\nIngest failed:", error);
  process.exit(1);
});
