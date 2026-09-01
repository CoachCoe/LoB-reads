/**
 * Load a rating corpus into the seed schema.
 *
 *   npx tsx scripts/social/load-ratings.ts --download   # fetch, then load
 *   npx tsx scripts/social/load-ratings.ts              # load what's on disk
 *   npx tsx scripts/social/load-ratings.ts --synthetic  # generate instead
 *
 * Recommendations need a ratings graph before the app has users. Without one,
 * "readers also enjoyed" has nothing to compute from and every list is empty.
 *
 * SOURCE AND LICENCE
 * goodbooks-10k: ~10K books, ~6M ratings, ~53K users.
 * https://github.com/zygmuntz/goodbooks-10k — Creative Commons
 * Attribution-ShareAlike 4.0.
 *
 * Redistribution is permitted with attribution, unlike the UCSD Book Graph,
 * which is academic-use-only. But ShareAlike is viral: anything derived from
 * it and then distributed inherits the licence. That is a large part of why
 * this lands in `seed` and stays behind ENABLE_SEED_DATA — nothing derived
 * from it is served, so the question never arises. Raw files are gitignored.
 *
 * The `--synthetic` mode exists because CI cannot download 100MB, and because
 * the pipeline should be testable without depending on a third party staying
 * online.
 */

import "../enrich/env";
import { createWriteStream, existsSync } from "node:fs";
import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import prisma from "@/lib/prisma";
import { corpusIsbnToCanonical } from "./corpus-isbn";

const DIR = "data/ratings";
const SOURCE = "goodbooks-10k";
const BASE = "https://raw.githubusercontent.com/zygmuntz/goodbooks-10k/master";

/**
 * Below this, the ISBN normalisation is wrong rather than the data being
 * sparse — per the spec, stop rather than build recommendations on a corpus
 * that mostly failed to join.
 */
const MIN_MATCH_RATE = 0.6;

async function download() {
  await mkdir(DIR, { recursive: true });
  for (const file of ["books.csv", "ratings.csv"]) {
    const target = path.join(DIR, file);
    if (existsSync(target)) {
      const { size } = await stat(target);
      console.log(`  ${file}: already present (${(size / 1e6).toFixed(1)}MB)`);
      continue;
    }
    console.log(`  ${file}: downloading…`);
    const response = await fetch(`${BASE}/${file}`);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download ${file}: HTTP ${response.status}`);
    }
    await pipeline(
      Readable.fromWeb(response.body as never),
      createWriteStream(target)
    );
    const { size } = await stat(target);
    console.log(`  ${file}: ${(size / 1e6).toFixed(1)}MB`);
  }
}

/** Minimal CSV split; these files have no embedded newlines or quoted commas. */
const split = (line: string) => line.split(",");

/**
 * books.csv maps the corpus's own book_id to ISBNs. That mapping is what lets
 * six million ratings become ratings of catalog works.
 */
async function loadBookIsbns(): Promise<Map<string, string>> {
  const byBookId = new Map<string, string>();
  const lines = createInterface({
    input: createReadStream(path.join(DIR, "books.csv")),
    crlfDelay: Infinity,
  });

  let header: string[] | null = null;
  for await (const line of lines) {
    if (!header) {
      header = split(line).map((h) => h.trim());
      continue;
    }
    const cols = split(line);
    const get = (name: string) => cols[header!.indexOf(name)]?.trim() ?? "";

    // See corpus-isbn.ts: this corpus's ISBN columns were coerced to numbers,
    // and only the isbn10 one is recoverable.
    const canonical = corpusIsbnToCanonical(get("isbn"));
    if (canonical) byBookId.set(get("book_id"), canonical);
  }

  return byBookId;
}

async function resolveWorkKeys(
  isbns: string[]
): Promise<Map<string, string>> {
  const found = new Map<string, string>();

  // Chunked: a single ANY() with hundreds of thousands of values is not a
  // query plan anyone enjoys.
  const CHUNK = 5_000;
  for (let i = 0; i < isbns.length; i += CHUNK) {
    const rows = await prisma.$queryRaw<{ isbn: string; workKey: string }[]>`
      SELECT isbn13 AS isbn, work_key AS "workKey"
      FROM catalog.editions
      WHERE work_key IS NOT NULL AND isbn13 = ANY(${isbns.slice(i, i + CHUNK)})
    `;
    for (const row of rows) found.set(row.isbn, row.workKey);
  }

  return found;
}

async function loadFromCorpus() {
  console.log("Reading books.csv…");
  const isbnByBookId = await loadBookIsbns();
  console.log(`  ${isbnByBookId.size} books with a usable ISBN`);

  console.log("Matching against the catalog…");
  const workByIsbn = await resolveWorkKeys([...new Set(isbnByBookId.values())]);

  const workByBookId = new Map<string, string>();
  for (const [bookId, isbn] of isbnByBookId) {
    const workKey = workByIsbn.get(isbn);
    if (workKey) workByBookId.set(bookId, workKey);
  }

  const matchRate = workByBookId.size / Math.max(isbnByBookId.size, 1);
  console.log(
    `  matched ${workByBookId.size} of ${isbnByBookId.size} ` +
      `(${(matchRate * 100).toFixed(1)}%)`
  );

  if (matchRate < MIN_MATCH_RATE) {
    console.error(
      `\nMatch rate is below ${MIN_MATCH_RATE * 100}%.\n` +
        "That points at the ISBN canonicalisation rather than sparse data —\n" +
        "or at a catalog slice too narrow to overlap the corpus. Widen the\n" +
        "slice in config/slice.yaml and re-ingest before loading ratings.\n"
    );
    process.exit(1);
  }

  console.log("Reading ratings.csv…");
  const lines = createInterface({
    input: createReadStream(path.join(DIR, "ratings.csv")),
    crlfDelay: Infinity,
  });

  const seenUsers = new Set<string>();
  let pendingUsers: { id: string; handle: string; source: string }[] = [];
  let pendingRatings: {
    userId: string;
    workKey: string;
    rating: number;
    source: string;
  }[] = [];
  let read = 0;
  let kept = 0;
  let header: string[] | null = null;

  const flush = async () => {
    if (pendingUsers.length) {
      await prisma.seedUser.createMany({
        data: pendingUsers,
        skipDuplicates: true,
      });
      pendingUsers = [];
    }
    if (pendingRatings.length) {
      await prisma.seedRating.createMany({
        data: pendingRatings,
        skipDuplicates: true,
      });
      pendingRatings = [];
    }
  };

  for await (const line of lines) {
    if (!header) {
      header = split(line).map((h) => h.trim());
      continue;
    }
    read++;
    const cols = split(line);
    const userId = cols[header.indexOf("user_id")]?.trim();
    const bookId = cols[header.indexOf("book_id")]?.trim();
    const rating = Number(cols[header.indexOf("rating")]);

    const workKey = bookId ? workByBookId.get(bookId) : undefined;
    if (!userId || !workKey || !Number.isInteger(rating)) continue;
    if (rating < 1 || rating > 5) continue;

    const seedUserId = `gb-${userId}`;
    if (!seenUsers.has(seedUserId)) {
      seenUsers.add(seedUserId);
      pendingUsers.push({
        id: seedUserId,
        handle: `reader_${userId}`,
        source: SOURCE,
      });
    }

    pendingRatings.push({ userId: seedUserId, workKey, rating, source: SOURCE });
    kept++;

    if (pendingRatings.length >= 5_000) {
      await flush();
      if (kept % 250_000 === 0) {
        console.log(`  ${kept.toLocaleString()} ratings loaded`);
      }
    }
  }

  await flush();
  console.log(
    `  ${kept.toLocaleString()} of ${read.toLocaleString()} ratings kept ` +
      `across ${seenUsers.size.toLocaleString()} readers`
  );
}

/**
 * A small deterministic graph, for tests and for a first look at the feature
 * without downloading 100MB. Readers are given overlapping taste so that
 * similarity has something to find; random ratings produce no signal at all.
 */
async function loadSynthetic(readerCount = 300) {
  const works = await prisma.$queryRaw<{ olKey: string }[]>`
    SELECT ol_key AS "olKey" FROM catalog.works
    ORDER BY edition_count DESC, ol_key LIMIT 200
  `;

  if (works.length < 4) {
    console.error("Not enough works in the catalog. Run the ingest first.");
    process.exit(1);
  }

  // Deterministic, so a failing test is reproducible.
  let state = 12345;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };

  // Overlapping clusters: readers mostly rate within a taste group, which is
  // what makes co-occurrence meaningful.
  const clusters = 8;
  const perCluster = Math.ceil(works.length / clusters);

  const users: { id: string; handle: string; source: string }[] = [];
  const ratings: {
    userId: string;
    workKey: string;
    rating: number;
    source: string;
  }[] = [];

  for (let i = 0; i < readerCount; i++) {
    const id = `syn-${i}`;
    users.push({ id, handle: `synthetic_${i}`, source: "synthetic" });

    const cluster = i % clusters;
    const start = cluster * perCluster;
    const pool = works.slice(start, start + perCluster);

    for (const work of pool) {
      if (random() > 0.55) continue; // not everyone reads everything
      ratings.push({
        userId: id,
        workKey: work.olKey,
        rating: 3 + Math.floor(random() * 3), // 3–5, as a taste group would
        source: "synthetic",
      });
    }

    // A little cross-cluster noise, so lists are not perfectly partitioned.
    for (let n = 0; n < 3; n++) {
      const work = works[Math.floor(random() * works.length)];
      ratings.push({
        userId: id,
        workKey: work.olKey,
        rating: 1 + Math.floor(random() * 5),
        source: "synthetic",
      });
    }
  }

  await prisma.seedUser.createMany({ data: users, skipDuplicates: true });
  // Deduplicate: the noise pass can collide with the cluster pass.
  const unique = new Map(ratings.map((r) => [`${r.userId}|${r.workKey}`, r]));
  await prisma.seedRating.createMany({
    data: [...unique.values()],
    skipDuplicates: true,
  });

  console.log(
    `  ${users.length} synthetic readers, ${unique.size} ratings across ${works.length} works`
  );
}

async function main() {
  const argv = process.argv.slice(2);

  console.log("Clearing existing seed data…");
  await prisma.seedRating.deleteMany();
  await prisma.seedUser.deleteMany();

  if (argv.includes("--synthetic")) {
    console.log("Generating a synthetic ratings graph…");
    await loadSynthetic();
  } else {
    if (argv.includes("--download")) await download();

    if (!existsSync(path.join(DIR, "ratings.csv"))) {
      console.error(
        `No corpus in ${DIR}. Either:\n` +
          "  npx tsx scripts/social/load-ratings.ts --download\n" +
          "  npx tsx scripts/social/load-ratings.ts --synthetic\n"
      );
      process.exit(1);
    }
    await loadFromCorpus();
  }

  const [users, ratings] = await Promise.all([
    prisma.seedUser.count(),
    prisma.seedRating.count(),
  ]);
  console.log(`\nSeed graph: ${users} readers, ${ratings} ratings`);
  console.log("Next: npx tsx scripts/social/compute-stats.ts");
}

main()
  .catch((error) => {
    console.error("Load failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
