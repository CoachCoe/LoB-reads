/**
 * Stage 2 — stage.
 *
 * Streams a gzipped dump into an UNLOGGED staging table via COPY. Row-by-row
 * inserts across tens of millions of rows take days; COPY takes minutes.
 *
 *   npx tsx scripts/ingest/02-stage.ts                    # all dumps
 *   npx tsx scripts/ingest/02-stage.ts authors            # one dump
 *   npx tsx scripts/ingest/02-stage.ts works --limit 5000 # first N valid rows
 *
 * Dump format is TSV with five columns: type, key, revision, last_modified,
 * json. Only the key and the JSON are kept; the rest is recoverable from it.
 */

import { createReadStream } from "node:fs";
import { mkdir, appendFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import path from "node:path";
import type { Client } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { connect } from "./db";
import { encodeStageRow } from "./copy-format";
import {
  DUMPS,
  LOAD_ORDER,
  QUARANTINE_DIR,
  RAW_DIR,
  stripKeyPrefix,
  type DumpType,
} from "./dumps";

const PROGRESS_EVERY = 500_000;

/** A silent 40-minute process is indistinguishable from a hung one. */
function logProgress(type: DumpType, read: number, staged: number, bad: number) {
  const pct = bad > 0 ? ` (${((bad / read) * 100).toFixed(3)}% quarantined)` : "";
  console.log(
    `    ${read.toLocaleString()} read, ${staged.toLocaleString()} staged, ${bad.toLocaleString()} bad${pct}`
  );
}

interface StageResult {
  linesRead: number;
  rowsStaged: number;
  quarantined: number;
}

async function stageDump(
  client: Client,
  type: DumpType,
  limit?: number
): Promise<StageResult> {
  const dump = DUMPS[type];
  const table = `catalog.stage_${type}`;
  const quarantineFile = path.join(QUARANTINE_DIR, `${type}.jsonl`);

  console.log(`  ${type}: staging into ${table}`);

  await client.query(`TRUNCATE ${table}`);

  const source = createReadStream(path.join(RAW_DIR, dump.file)).pipe(
    createGunzip()
  );
  const lines = createInterface({ input: source, crlfDelay: Infinity });

  const copyStream = client.query(
    copyFrom(`COPY ${table} (ol_key, revision, last_modified, data) FROM STDIN`)
  );

  let linesRead = 0;
  let rowsStaged = 0;
  let quarantined = 0;
  let quarantineBuffer: string[] = [];

  const flushQuarantine = async () => {
    if (quarantineBuffer.length === 0) return;
    await appendFile(quarantineFile, quarantineBuffer.join("\n") + "\n");
    quarantineBuffer = [];
  };

  const write = (chunk: string): Promise<void> =>
    copyStream.write(chunk)
      ? Promise.resolve()
      : new Promise((resolve) => copyStream.once("drain", () => resolve()));

  for await (const line of lines) {
    linesRead++;

    if (line.length === 0) continue;

    const columns = line.split("\t");
    if (columns.length < 5) {
      quarantined++;
      quarantineBuffer.push(
        JSON.stringify({ line: linesRead, reason: "too few columns", raw: line.slice(0, 500) })
      );
      if (quarantineBuffer.length >= 1000) await flushQuarantine();
      continue;
    }

    const [recordType, rawKey, revision, lastModified, json] = columns;

    // Redirects appear in the dumps and are not records. Skipped here; resolve
    // them at normalize time if dead links ever matter.
    if (recordType === "/type/redirect") continue;

    // A fraction of lines carry malformed JSON or embedded control characters.
    // One bad line must never kill a 40-minute stream.
    try {
      JSON.parse(json);
    } catch {
      quarantined++;
      quarantineBuffer.push(
        JSON.stringify({ line: linesRead, reason: "invalid json", key: rawKey })
      );
      if (quarantineBuffer.length >= 1000) await flushQuarantine();
      continue;
    }

    const row = encodeStageRow(
      stripKeyPrefix(rawKey),
      revision,
      lastModified,
      json
    );

    await write(row);
    rowsStaged++;

    if (linesRead % PROGRESS_EVERY === 0) {
      logProgress(type, linesRead, rowsStaged, quarantined);
    }

    if (limit !== undefined && rowsStaged >= limit) {
      console.log(`    reached --limit ${limit}, stopping early`);
      break;
    }
  }

  copyStream.end();
  await new Promise<void>((resolve, reject) => {
    copyStream.on("finish", resolve);
    copyStream.on("error", reject);
  });

  await flushQuarantine();
  lines.close();
  source.destroy();

  logProgress(type, linesRead, rowsStaged, quarantined);
  return { linesRead, rowsStaged, quarantined };
}

async function main() {
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf("--limit");
  const limit = limitIndex !== -1 ? Number(args[limitIndex + 1]) : undefined;
  const requested = args.filter(
    (a, i) => !a.startsWith("--") && i !== limitIndex + 1
  ) as DumpType[];
  const selected = requested.length > 0 ? requested : LOAD_ORDER;

  await mkdir(QUARANTINE_DIR, { recursive: true });

  const client = await connect();

  try {
    for (const type of selected) {
      const runId = await startRun(client, type);
      try {
        const result = await stageDump(client, type, limit);
        await finishRun(client, runId, result);

        const badRatio = result.linesRead > 0 ? result.quarantined / result.linesRead : 0;
        if (badRatio > 0.001) {
          console.warn(
            `    WARNING ${type}: ${(badRatio * 100).toFixed(3)}% quarantined, above the 0.1% threshold`
          );
        }
      } catch (error) {
        await failRun(client, runId, error);
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

async function startRun(client: Client, type: DumpType): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO catalog.ingest_runs (id, dump_type, status)
     VALUES (gen_random_uuid()::text, $1, 'running') RETURNING id`,
    [type]
  );
  return rows[0].id;
}

async function finishRun(client: Client, id: string, r: StageResult) {
  await client.query(
    `UPDATE catalog.ingest_runs
        SET status='completed', completed_at=now(),
            lines_read=$2, rows_staged=$3, lines_quarantined=$4
      WHERE id=$1`,
    [id, r.linesRead, r.rowsStaged, r.quarantined]
  );
}

async function failRun(client: Client, id: string, error: unknown) {
  await client.query(
    `UPDATE catalog.ingest_runs
        SET status='failed', completed_at=now(), error=$2
      WHERE id=$1`,
    [id, error instanceof Error ? error.message : String(error)]
  );
}

main().catch((error) => {
  console.error("Stage failed:", error);
  process.exit(1);
});
