/**
 * Stage 1 — acquire.
 *
 * Downloads the Open Library dumps to data/raw/, resuming partial downloads
 * with a Range request. Nothing is decompressed here; stage 2 streams the gzip
 * directly, because the editions dump alone expands to tens of gigabytes.
 *
 *   npx tsx scripts/ingest/01-acquire.ts            # all dumps
 *   npx tsx scripts/ingest/01-acquire.ts authors    # just one
 */

import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { Agent, fetch as undiciFetch } from "undici";
import { DUMPS, LOAD_ORDER, RAW_DIR, type Dump, type DumpType } from "./dumps";

/**
 * Node's global fetch hard-codes a 10-second connect timeout and offers no way
 * to change it. openlibrary.org's TLS handshake from a home connection was
 * measured between 0.1s and just over 10s, so the download failed on a coin
 * flip — five consecutive attempts died before a byte of the 741MB arrived,
 * while `curl` on the same machine succeeded, because curl simply waits.
 *
 * Hence an explicit dispatcher. The other two timeouts matter as much: these
 * are multi-gigabyte transfers, and archive.org can stall mid-stream for
 * longer than the defaults tolerate. All three are inactivity timeouts, not
 * total-duration limits, so a slow-but-progressing download is never cut off.
 */
const agent = new Agent({
  connect: { timeout: 60_000 },
  headersTimeout: 120_000,
  bodyTimeout: 300_000,
});

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)}${units[unit]}`;
}

async function sizeOnDisk(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

/**
 * Attempts per dump before giving up.
 *
 * These are multi-gigabyte transfers from archive.org over tens of minutes, so
 * a dropped connection is a normal event rather than an exceptional one — the
 * first real run died on a 10-second connect timeout after 11KB. Because
 * archive.org honours Range, a retry resumes from what is already on disk, so
 * an attempt costs only the bytes still missing.
 */
const MAX_ATTEMPTS = 5;

/** Backoff between attempts, capped. Jittered to avoid a synchronised retry. */
function backoffMs(attempt: number): number {
  return Math.min(30_000, 2 ** attempt * 1_000) + Math.random() * 1_000;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function downloadWithRetry(dump: Dump): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await download(dump);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(
          `${dump.type}: giving up after ${MAX_ATTEMPTS} attempts — ${message}`
        );
      }
      const wait = backoffMs(attempt);
      console.log(
        `    attempt ${attempt} failed (${message}); retrying in ${Math.round(
          wait / 1000
        )}s — the partial file is kept and resumed`
      );
      await sleep(wait);
    }
  }
}

async function download(dump: Dump): Promise<void> {
  const target = path.join(RAW_DIR, dump.file);
  const existing = await sizeOnDisk(target);

  // A HEAD tells us the full size, so a completed file can be skipped and a
  // partial one resumed rather than re-fetched.
  const head = await undiciFetch(dump.url, { method: "HEAD", dispatcher: agent });
  if (!head.ok) {
    throw new Error(`HEAD ${dump.url} failed: ${head.status}`);
  }

  const totalHeader = head.headers.get("content-length");
  const total = totalHeader ? Number(totalHeader) : undefined;
  const lastModified = head.headers.get("last-modified");

  if (total !== undefined && existing === total) {
    console.log(
      `  ${dump.type}: already complete (${formatBytes(existing)})${
        lastModified ? `, published ${lastModified}` : ""
      }`
    );
    return;
  }

  const resuming = existing > 0 && total !== undefined && existing < total;
  if (resuming) {
    console.log(
      `  ${dump.type}: resuming at ${formatBytes(existing)} of ${formatBytes(total!)}`
    );
  } else {
    console.log(
      `  ${dump.type}: downloading ${formatBytes(total ?? dump.approxBytes)}${
        lastModified ? ` (published ${lastModified})` : ""
      }`
    );
  }

  const response = await undiciFetch(dump.url, {
    headers: resuming ? { Range: `bytes=${existing}-` } : {},
    dispatcher: agent,
  });

  if (!response.ok || !response.body) {
    throw new Error(`GET ${dump.url} failed: ${response.status}`);
  }

  // A server that ignores Range replies 200 with the whole file; appending in
  // that case would corrupt the result, so start over.
  const append = resuming && response.status === 206;
  if (resuming && !append) {
    console.log("    server ignored Range, restarting from zero");
  }

  let written = append ? existing : 0;
  let lastLogged = Date.now();

  const source = Readable.fromWeb(response.body as never);
  source.on("data", (chunk: Buffer) => {
    written += chunk.length;
    if (Date.now() - lastLogged > 10_000) {
      const pct = total ? ` (${((written / total) * 100).toFixed(1)}%)` : "";
      console.log(`    ${formatBytes(written)}${pct}`);
      lastLogged = Date.now();
    }
  });

  await pipeline(source, createWriteStream(target, { flags: append ? "a" : "w" }));

  console.log(`  ${dump.type}: done, ${formatBytes(await sizeOnDisk(target))}`);
}

async function main() {
  const requested = process.argv.slice(2) as DumpType[];
  const selected = requested.length > 0 ? requested : LOAD_ORDER;

  for (const type of selected) {
    if (!DUMPS[type]) {
      throw new Error(
        `Unknown dump "${type}". Expected one of: ${LOAD_ORDER.join(", ")}`
      );
    }
  }

  await mkdir(RAW_DIR, { recursive: true });
  console.log(`Acquiring ${selected.length} dump(s) into ${RAW_DIR}/`);

  for (const type of selected) {
    await downloadWithRetry(DUMPS[type]);
  }
}

main().catch((error) => {
  console.error("Acquire failed:", error);
  process.exit(1);
});
