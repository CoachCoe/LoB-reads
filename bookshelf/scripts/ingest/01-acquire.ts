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

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, readFile, writeFile, rm } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { Agent, fetch as undiciFetch } from "undici";
import { DUMPS, LOAD_ORDER, RAW_DIR, type Dump, type DumpType } from "./dumps";
import { decideResume, type PartialMeta } from "./resume-policy";

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
 * What a partial file is a partial OF.
 *
 * Resuming means appending to bytes we did not fetch this run and have never
 * checked. If those bytes came from a different publication of the dump — or
 * from a failed attempt that wrote garbage — appending produces a file of
 * exactly the right length and entirely wrong content.
 *
 * That is not hypothetical: the first real run resumed onto 11KB left by an
 * earlier failure, finished at precisely the advertised 741.6MB, and was
 * corrupt. The only hint was `gzip: trailing garbage ignored`, which is easy
 * to miss and arrives long after the download.
 *
 * So a partial is only resumed when this sidecar says it belongs to the same
 * remote object, and the sidecar persists after completion as the record that
 * this exact file was checked. Without it, a finished-but-corrupt download is
 * indistinguishable from a good one — the length matches either way, which is
 * how the corrupt file was skipped as "already complete" on the next run.
 */
const metaPath = (target: string) => `${target}.meta.json`;

async function readMeta(target: string): Promise<PartialMeta | null> {
  try {
    return JSON.parse(await readFile(metaPath(target), "utf8")) as PartialMeta;
  } catch {
    return null;
  }
}

/** Stream the archive through gunzip, discarding output, to prove it is intact. */
async function verifyGzip(file: string): Promise<void> {
  await pipeline(createReadStream(file), createGunzip(), async function (source) {
    // Consume and discard; a truncated or corrupt member throws here.
    for await (const _chunk of source) {
      void _chunk;
    }
  });
}

/**
 * Consecutive attempts that move no bytes before giving up.
 *
 * Counting total attempts is the wrong model for a twelve-gigabyte transfer.
 * The editions dump failed at 93.7% against a five-attempt cap: archive.org
 * dropped the connection repeatedly, but every attempt still moved data before
 * dying. Those are not failures in the sense the cap was built for — the
 * download was progressing, just not in one unbroken stream.
 *
 * So what counts is attempts that achieve nothing. An attempt that transfers
 * even a byte resets the counter, and the download continues; an attempt that
 * cannot get past the connect keeps it climbing.
 */
const MAX_STALLED_ATTEMPTS = 6;

/**
 * Overall ceiling, so a connection that dribbles a few kilobytes per attempt
 * cannot loop forever. Generous: a resumed attempt is cheap, and giving up on
 * a nearly complete multi-hour download is expensive.
 */
const MAX_TOTAL_ATTEMPTS = 60;

/** Backoff between attempts, capped. Jittered to avoid a synchronised retry. */
function backoffMs(attempt: number): number {
  return Math.min(30_000, 2 ** attempt * 1_000) + Math.random() * 1_000;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function downloadWithRetry(dump: Dump): Promise<void> {
  const target = path.join(RAW_DIR, dump.file);
  let stalled = 0;
  let total = 0;

  while (stalled < MAX_STALLED_ATTEMPTS && total < MAX_TOTAL_ATTEMPTS) {
    const before = await sizeOnDisk(target);
    total++;

    try {
      await download(dump);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const after = await sizeOnDisk(target);
      const gained = after - before;

      if (gained > 0) {
        // Progress was made, so this is an interrupted transfer rather than a
        // dead one. Start the stall count over.
        stalled = 0;
        console.log(
          `    interrupted after ${formatBytes(gained)} (${message}); resuming`
        );
      } else {
        stalled++;
        console.log(
          `    attempt ${total} moved nothing (${message}); ` +
            `${MAX_STALLED_ATTEMPTS - stalled} stalled attempts left`
        );
      }

      if (stalled >= MAX_STALLED_ATTEMPTS || total >= MAX_TOTAL_ATTEMPTS) break;
      await sleep(backoffMs(Math.min(stalled, 5)));
    }
  }

  throw new Error(
    `${dump.type}: giving up after ${total} attempts, ` +
      `${stalled} of them without progress. The partial file is kept — rerun to resume.`
  );
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
  const etag = head.headers.get("etag");

  const existingMeta = existing > 0 ? await readMeta(target) : null;
  const remote = { etag, lastModified, total };
  const decision = decideResume(existing, existingMeta, remote);

  const writeMeta = (verified: boolean) =>
    total === undefined
      ? Promise.resolve()
      : writeFile(
          metaPath(target),
          JSON.stringify({ etag, lastModified, total, verified } satisfies PartialMeta)
        );

  if (decision.action === "skip") {
    console.log(
      `  ${dump.type}: already complete and verified (${formatBytes(existing)})${
        lastModified ? `, published ${lastModified}` : ""
      }`
    );
    return;
  }

  if (decision.action === "verify") {
    // Right length, unproven. Length is not integrity: a file stitched from
    // two publications of the same dump has precisely this size.
    console.log(
      `  ${dump.type}: ${formatBytes(existing)} on disk but unverified — checking it decompresses…`
    );
    try {
      await verifyGzip(target);
      await writeMeta(true);
      console.log(`  ${dump.type}: intact, keeping it`);
      return;
    } catch {
      console.log(`  ${dump.type}: corrupt — discarding and downloading again`);
      await rm(target, { force: true });
      await rm(metaPath(target), { force: true });
    }
  }

  if (decision.action === "restart" && existing > 0) {
    console.log(
      `    discarding ${formatBytes(existing)} that cannot be shown to belong to the current dump`
    );
    await rm(target, { force: true });
    await rm(metaPath(target), { force: true });
  }

  const from = decision.action === "resume" ? decision.from : 0;
  const resuming = from > 0;

  await writeMeta(false);

  if (resuming) {
    console.log(
      `  ${dump.type}: resuming at ${formatBytes(from)} of ${formatBytes(total!)}`
    );
  } else {
    console.log(
      `  ${dump.type}: downloading ${formatBytes(total ?? dump.approxBytes)}${
        lastModified ? ` (published ${lastModified})` : ""
      }`
    );
  }

  const response = await undiciFetch(dump.url, {
    headers: resuming ? { Range: `bytes=${from}-` } : {},
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

  let written = append ? from : 0;
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

  const finalSize = await sizeOnDisk(target);
  if (total !== undefined && finalSize !== total) {
    throw new Error(
      `${dump.type}: expected ${total} bytes, got ${finalSize} — treating as incomplete`
    );
  }

  // Length is not integrity. A resumed file can be exactly the right size and
  // still be two different dumps stitched together, so prove it decompresses
  // before anything downstream depends on it.
  if (append) {
    console.log("    verifying the resumed archive decompresses…");
    try {
      await verifyGzip(target);
    } catch (error) {
      await rm(target, { force: true });
      await rm(metaPath(target), { force: true });
      throw new Error(
        `${dump.type}: resumed archive is corrupt (${
          error instanceof Error ? error.message : String(error)
        }); discarded it so the retry starts clean`
      );
    }
  }

  await writeMeta(append);
  console.log(`  ${dump.type}: done, ${formatBytes(finalSize)}`);
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
