import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NotFoundError } from "@/lib/http/errors";

/**
 * Reads over the Open Library catalog.
 *
 * Raw SQL rather than Prisma: the search ranking needs `ts_rank_cd`,
 * `similarity()` and a weighted expression that Prisma cannot express, and the
 * `search_vector` column has no Prisma type at all.
 *
 * Accents are folded on BOTH sides, or "Miserables" silently misses "Les
 * Misérables". The stored side is folded at write time by the trigger, into
 * `search_vector` and the `*_norm` columns; the query side folds the user's
 * input with `unaccent()` here.
 *
 * Comparisons therefore go against `title_norm` / `author_names_norm`, never
 * `lower(unaccent(title))`. They are equal in meaning but not to the planner:
 * a function of a column cannot use that column's index, and `unaccent()` is
 * STABLE so no expression index can stand in. Wrapping the column is how the
 * fuzzy path silently became a sequential scan once already.
 */

export interface WorkSearchResult {
  olKey: string;
  title: string;
  subtitle: string | null;
  authorNames: string | null;
  firstPublishYear: number | null;
  editionCount: number;
  coverEditionKey: string | null;
  coverId: number | null;
  rank: number;
}

export interface WorkEdition {
  olKey: string;
  title: string;
  subtitle: string | null;
  isbn13: string | null;
  isbn10: string | null;
  publishers: string[];
  publishDateRaw: string | null;
  publishYear: number | null;
  numberOfPages: number | null;
  languages: string[];
  physicalFormat: string | null;
  coverId: number | null;
}

export interface WorkDetail {
  olKey: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  /**
   * Set when the description came from a third party rather than Open Library.
   * The UI must attribute it: cached content may not be presented as our own.
   */
  descriptionSource?: string | null;
  firstPublishYear: number | null;
  subjects: string[];
  editionCount: number;
  coverEditionKey: string | null;
  authors: { olKey: string; name: string }[];
  editions: WorkEdition[];
}

/** Editions shown on a work page before "show all". */
export const EDITIONS_PAGE_SIZE = 25;

/**
 * Ranking weights.
 *
 * ts_rank alone puts "Dune Messiah" above "Dune" for the query "dune", because
 * relevance scoring does not know that an exact title is what a person
 * searching a book title almost always wants. The exact and prefix terms carry
 * most of the decision; the rest break ties.
 */
const W_EXACT = 100; // title is exactly the query
const W_PREFIX = 20; // title starts with the query
const W_FTS = 10; // full-text relevance
const W_TRIGRAM = 5; // fuzzy similarity, covers typos
const W_POPULARITY = 0.5; // edition count, as a tiebreak only

/**
 * The search statement.
 *
 * A bounded-candidate version of this was tried and REVERTED — see PRD R1. It
 * capped what reached the ranking expression by unioning four per-strategy
 * subqueries, each `ORDER BY w.edition_count DESC LIMIT n`. Measured against the
 * real 6.9M-work catalog it took `?q=dune` from 222ms to 71 seconds.
 *
 * The reason is worth keeping, because it is a trap anyone bounding this query
 * will walk into. `ORDER BY edition_count DESC LIMIT 200` invites the planner to
 * walk `works_edition_count_ol_key_idx` in popularity order and filter as it
 * goes, on the assumption it will fill 200 rows early. `title_norm LIKE 'dune%'`
 * matches 113 rows in 6.9M, so it walked all 6,943,467 of them — 10.9 seconds in
 * one subquery, and the same shape in a second.
 *
 * Every subquery was fast in isolation (7-335ms). Only the combination was slow,
 * and only at real scale: at 3,000 fixture rows walking the whole table is
 * instant, so no fixture-based test could see it. That is the same lesson
 * STATUS.md already records, learned again the hard way.
 */
export function searchWorksSql(
  query: string,
  { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {}
): Prisma.Sql {
  // `websearch_to_tsquery` handles quoted phrases and OR without throwing on
  // punctuation the way `to_tsquery` does with raw user input.
  return Prisma.sql`
    WITH q AS (
      SELECT
        websearch_to_tsquery('english', unaccent(${query})) AS tsq,
        -- unaccent first: under lc_collate=C, lower() folds only ASCII, so
        -- lower('Ö') is still 'Ö' and unaccent then gives a capital 'O'. Both
        -- sides shared that fault, so same-casing queries matched and nothing
        -- looked wrong — a lowercase-accented query just silently lost the
        -- W_PREFIX bonus. DEAD-5.
        lower(unaccent(${query}))                           AS norm
    )
    SELECT
      w.ol_key                                   AS "olKey",
      w.title,
      w.subtitle,
      w.author_names                             AS "authorNames",
      w.first_publish_year                       AS "firstPublishYear",
      w.edition_count                            AS "editionCount",
      w.cover_edition_key                        AS "coverEditionKey",
      e.cover_id::int                            AS "coverId",
      (
          (CASE WHEN w.title_norm = q.norm THEN ${W_EXACT} ELSE 0 END)
        + (CASE WHEN w.title_norm LIKE q.norm || '%' THEN ${W_PREFIX} ELSE 0 END)
        + ts_rank_cd(w.search_vector, q.tsq) * ${W_FTS}
        + similarity(w.title_norm, q.norm) * ${W_TRIGRAM}
        + ln(1 + w.edition_count) * ${W_POPULARITY}
      )::double precision                        AS rank
    FROM catalog.works w
    CROSS JOIN q
    LEFT JOIN catalog.editions e ON e.ol_key = w.cover_edition_key
    WHERE w.search_vector @@ q.tsq
       OR w.title_norm % q.norm
    ORDER BY rank DESC, w.edition_count DESC, w.ol_key
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export async function searchWorks(
  query: string,
  { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<WorkSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  return prisma.$queryRaw<WorkSearchResult[]>(
    searchWorksSql(trimmed, { limit, offset })
  );
}

/**
 * Matches counted up to a ceiling, for pagination.
 *
 * Counting exactly means reading every matching row. On the real catalog a
 * common word is not a rare case — "Fiction" matches 735,956 works, because
 * subjects are indexed too, and counting them took 5.5 seconds. Stopping at
 * COUNT_CEILING takes 49ms.
 *
 * Nothing is lost: a reader does not page to result 735,000, and the UI shows
 * "1,000+" rather than a precise number it cannot act on. `atCeiling` says
 * which it is, so the caller never presents a capped figure as exact.
 */
export const COUNT_CEILING = 1000;

/**
 * Works carrying a subject, most editions first.
 *
 * A browse, not a search. Subjects were removed from `search_vector` because
 * as a D-weighted term they made every generic word match most of the catalog
 * — "Fiction" matched 735,956 works, and ranking that many means reading every
 * one of them. An indexed array containment lookup answers the question the
 * subject chips are actually asking, and does it in milliseconds.
 */
/**
 * The statements behind the hot read paths, as `Prisma.Sql` rather than inline
 * tagged templates.
 *
 * read-path-plans.test.ts used to EXPLAIN SQL typed into the test, so it
 * asserted the shape of its own copy: three of the four bugs its header lists
 * could be reintroduced here while it stayed green. Exporting the builder means
 * the plan assertions run against the statement this module actually sends.
 */
export function worksBySubjectSql(
  subject: string,
  { limit = 24, offset = 0 }: { limit?: number; offset?: number } = {}
): Prisma.Sql {
  return Prisma.sql`
    SELECT
      w.ol_key             AS "olKey",
      w.title,
      w.subtitle,
      w.author_names       AS "authorNames",
      w.first_publish_year AS "firstPublishYear",
      w.edition_count      AS "editionCount",
      w.cover_edition_key  AS "coverEditionKey",
      e.cover_id::int      AS "coverId",
      0::double precision  AS rank
    FROM catalog.works w
    LEFT JOIN catalog.editions e ON e.ol_key = w.cover_edition_key
    WHERE w.subjects @> ARRAY[${subject}]::text[]
    ORDER BY w.edition_count DESC, w.ol_key
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export async function getWorksBySubject(
  subject: string,
  { limit = 24, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<WorkSearchResult[]> {
  const trimmed = subject.trim();
  if (trimmed.length === 0) return [];

  return prisma.$queryRaw<WorkSearchResult[]>(
    worksBySubjectSql(trimmed, { limit, offset })
  );
}

/**
 * How many works carry a subject, up to the same ceiling as search.
 *
 * Read from the precomputed counts where possible — that is exact and free.
 * Falls back to a bounded count for a subject the ingest has not counted,
 * which happens only between adding a work and the next rebuild.
 */
export async function countWorksBySubject(
  subject: string
): Promise<{ count: number; atCeiling: boolean }> {
  const trimmed = subject.trim();
  if (trimmed.length === 0) return { count: 0, atCeiling: false };

  const [cached] = await prisma.$queryRaw<{ workCount: number }[]>`
    SELECT work_count AS "workCount" FROM catalog.subject_counts
    WHERE subject = ${trimmed}
  `;
  if (cached) return { count: cached.workCount, atCeiling: false };

  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count FROM (
      SELECT 1 FROM catalog.works
      WHERE subjects @> ARRAY[${trimmed}]::text[]
      LIMIT ${COUNT_CEILING}
    ) t
  `;
  const count = Number(rows[0]?.count ?? 0);
  return { count, atCeiling: count >= COUNT_CEILING };
}

export function countWorkMatchesSql(query: string): Prisma.Sql {
  return Prisma.sql`
    SELECT count(*) AS count FROM (
      SELECT 1
      FROM catalog.works w
      CROSS JOIN (
        SELECT
          websearch_to_tsquery('english', unaccent(${query})) AS tsq,
          lower(unaccent(${query}))                           AS norm
      ) q
      WHERE w.search_vector @@ q.tsq
         OR w.title_norm % q.norm
      LIMIT ${COUNT_CEILING}
    ) matched
  `;
}

export async function countWorkMatches(
  query: string
): Promise<{ count: number; atCeiling: boolean }> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { count: 0, atCeiling: false };

  const rows = await prisma.$queryRaw<{ count: bigint }[]>(
    countWorkMatchesSql(trimmed)
  );
  const count = Number(rows[0]?.count ?? 0);
  return { count, atCeiling: count >= COUNT_CEILING };
}

export async function getWorkByKey(olKey: string): Promise<WorkDetail | null> {
  // Canonical description wins; third-party enrichment fills the gap. Expired
  // enrichment is ignored rather than shown — the licence under which it was
  // cached has a shelf life, and so does the value.
  const [work] = await prisma.$queryRaw<
    Array<Omit<WorkDetail, "authors" | "editions"> & { descriptionSource: string | null }>
  >`
    SELECT
      w.ol_key             AS "olKey",
      w.title,
      w.subtitle,
      coalesce(w.description, e.value #>> '{}') AS description,
      CASE WHEN w.description IS NULL AND e.value #>> '{}' IS NOT NULL
           THEN e.source ELSE NULL END          AS "descriptionSource",
      w.first_publish_year AS "firstPublishYear",
      w.subjects,
      w.edition_count      AS "editionCount",
      w.cover_edition_key  AS "coverEditionKey"
    FROM catalog.works w
    LEFT JOIN catalog.enrichment e
      ON e.entity_type = 'work' AND e.entity_key = w.ol_key
     AND e.field = 'description'
     AND (e.expires_at IS NULL OR e.expires_at > now())
    WHERE w.ol_key = ${olKey}
  `;

  if (!work) return null;

  const [authors, editions] = await Promise.all([
    prisma.$queryRaw<WorkDetail["authors"]>`
      SELECT a.ol_key AS "olKey", a.name
      FROM catalog.work_authors wa
      JOIN catalog.authors a ON a.ol_key = wa.author_key
      WHERE wa.work_key = ${olKey}
      ORDER BY wa.position
    `,
    getWorkEditions(olKey),
  ]);

  return { ...work, authors, editions };
}

/**
 * Editions of a work, newest first with undated ones last. A popular work can
 * have hundreds, so this is paged rather than returned whole.
 */
export async function getWorkEditions(
  olKey: string,
  { limit = EDITIONS_PAGE_SIZE, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<WorkEdition[]> {
  return prisma.$queryRaw<WorkEdition[]>`
    SELECT
      ol_key            AS "olKey",
      title,
      subtitle,
      isbn13,
      isbn10,
      publishers,
      publish_date_raw  AS "publishDateRaw",
      publish_year      AS "publishYear",
      number_of_pages   AS "numberOfPages",
      languages,
      physical_format   AS "physicalFormat",
      cover_id::int     AS "coverId"
    FROM catalog.editions
    WHERE work_key = ${olKey}
    ORDER BY publish_year DESC NULLS LAST, ol_key
    LIMIT ${limit} OFFSET ${offset}
  `;
}

/** Other works by the same author, for the work page. */
export async function getOtherWorksByAuthor(
  authorKey: string,
  excludeWorkKey: string,
  limit = 6
): Promise<Pick<WorkSearchResult, "olKey" | "title" | "firstPublishYear" | "coverEditionKey" | "coverId">[]> {
  return prisma.$queryRaw`
    SELECT
      w.ol_key             AS "olKey",
      w.title,
      w.first_publish_year AS "firstPublishYear",
      w.cover_edition_key  AS "coverEditionKey",
      e.cover_id::int      AS "coverId"
    FROM catalog.work_authors wa
    JOIN catalog.works w ON w.ol_key = wa.work_key
    LEFT JOIN catalog.editions e ON e.ol_key = w.cover_edition_key
    WHERE wa.author_key = ${authorKey}
      AND w.ol_key <> ${excludeWorkKey}
    ORDER BY w.edition_count DESC, w.ol_key
    LIMIT ${limit}
  `;
}

/** Browse entry point: the works with the most editions. */
export function popularWorksSql(limit = 24): Prisma.Sql {
  return Prisma.sql`
    SELECT
      w.ol_key             AS "olKey",
      w.title,
      w.subtitle,
      w.author_names       AS "authorNames",
      w.first_publish_year AS "firstPublishYear",
      w.edition_count      AS "editionCount",
      w.cover_edition_key  AS "coverEditionKey",
      e.cover_id::int      AS "coverId",
      0::double precision  AS rank
    FROM catalog.works w
    LEFT JOIN catalog.editions e ON e.ol_key = w.cover_edition_key
    ORDER BY w.edition_count DESC, w.ol_key
    LIMIT ${limit}
  `;
}

export async function getPopularWorks(limit = 24): Promise<WorkSearchResult[]> {
  return prisma.$queryRaw<WorkSearchResult[]>(popularWorksSql(limit));
}

/** Distinct subjects across the catalog, for browse filters. */
/**
 * The most common subjects, for the discover page.
 *
 * Read from catalog.subject_counts, which the ingest computes at the end of a
 * rebuild. Aggregating it live meant a sequential scan over every work,
 * unnesting subjects into millions of rows — 3.9 seconds on a 6.9M-work
 * catalog, on every request.
 *
 * Empty before the first ingest populates it, which renders as no subject
 * chips rather than an error. Deliberately not falling back to the live
 * aggregate: that fallback would be invisible on a small catalog and would
 * reintroduce the four-second page the moment the table went missing.
 */
export function catalogSubjectsSql(limit = 40): Prisma.Sql {
  return Prisma.sql`
    SELECT subject FROM catalog.subject_counts
    ORDER BY work_count DESC, subject
    LIMIT ${limit}
  `;
}

export async function getCatalogSubjects(limit = 40): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ subject: string }[]>(
    catalogSubjectsSql(limit)
  );
  return rows.map((r) => r.subject);
}

/**
 * Summary of a work, as shown in a shelf, a review or an activity feed.
 * Deliberately small: these are fetched in bulk.
 */
export interface WorkSummary {
  olKey: string;
  title: string;
  authorNames: string | null;
  firstPublishYear: number | null;
  coverId: number | null;
}

/**
 * Hydrate work keys into displayable works.
 *
 * User data stores only a `work_key`, because `app` holds no foreign key into
 * `catalog` — a bad ingest must not cascade into shelves and reviews. The cost
 * of that decision is paid here: a caller with a list of keys does one bulk
 * lookup rather than a join.
 *
 * Keys with no matching work are simply absent from the map. That happens
 * legitimately — an ingest can drop a work the slice no longer covers — so
 * callers must handle a missing entry rather than assume one.
 */
export async function getWorksByKeys(
  keys: string[]
): Promise<Map<string, WorkSummary>> {
  const unique = [...new Set(keys)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const rows = await prisma.$queryRaw<WorkSummary[]>`
    SELECT
      w.ol_key             AS "olKey",
      w.title,
      w.author_names       AS "authorNames",
      w.first_publish_year AS "firstPublishYear",
      e.cover_id::int      AS "coverId"
    FROM catalog.works w
    LEFT JOIN catalog.editions e ON e.ol_key = w.cover_edition_key
    WHERE w.ol_key = ANY(${unique})
  `;

  return new Map(rows.map((row) => [row.olKey, row]));
}

/**
 * Page count for one edition **of a given work**.
 *
 * Scoped by `work_key` as well as `ol_key`. Without it a reader could start a
 * session on a 480-page book naming an edition of something else entirely, and
 * the session's `pageCount` snapshot — which the progress UI now treats as the
 * single source of truth, and which `updateProgress` validates page numbers
 * against — would be that other book's. The row is frozen by design, so it stays
 * wrong permanently, and /wrapped reports the work as the reader's longest of the
 * year. `getDefaultEdition` below has always filtered on `work_key`; only the
 * explicit-editionKey path did not. See FLOW-5.
 *
 * Throws `NotFoundError` when the work has no such edition. It returns `null`
 * for "that edition states no page count", which is a normal answer — and a
 * signature carrying both absences as values invites `if (!pages)`, which is
 * wrong for exactly one of them.
 */
export async function getEditionPageCount(
  workKey: string,
  editionKey: string
): Promise<number | null> {
  const rows = await prisma.$queryRaw<{ pages: number | null }[]>`
    SELECT number_of_pages AS pages FROM catalog.editions
    WHERE ol_key = ${editionKey} AND work_key = ${workKey}
  `;
  if (rows.length === 0) {
    throw new NotFoundError("That edition is not part of this book");
  }
  return rows[0].pages;
}

/** The edition a reader is most likely to hold, for a default page count. */
export async function getDefaultEdition(
  workKey: string
): Promise<{ olKey: string; numberOfPages: number | null } | null> {
  const rows = await prisma.$queryRaw<
    { olKey: string; numberOfPages: number | null }[]
  >`
    SELECT ol_key AS "olKey", number_of_pages AS "numberOfPages"
    FROM catalog.editions
    WHERE work_key = ${workKey}
    ORDER BY (number_of_pages IS NULL), publish_year DESC NULLS LAST, ol_key
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** True when the key exists in the catalog. Routes validate before writing. */
export async function workExists(workKey: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM catalog.works WHERE ol_key = ${workKey}) AS exists
  `;
  return rows[0]?.exists ?? false;
}

/**
 * Resolve ISBNs to catalog works, for the Goodreads import.
 *
 * One query for a whole export. This used to be one Open Library HTTP request
 * per unmatched book; with the catalog held locally there is no network call
 * in the import at all.
 */
export async function findWorkKeysByIsbns(
  isbns: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(isbns)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const rows = await prisma.$queryRaw<{ isbn: string; workKey: string }[]>`
    SELECT isbn13 AS isbn, work_key AS "workKey"
    FROM catalog.editions
    WHERE work_key IS NOT NULL AND isbn13 = ANY(${unique})
  `;

  return new Map(rows.map((r) => [r.isbn, r.workKey]));
}

/** Last-resort match on exact title and author, for rows with no usable ISBN. */
export async function findWorkKeyByTitleAuthor(
  title: string,
  author: string
): Promise<string | null> {
  // `author` is bound safely, but binding does not disarm LIKE's own
  // metacharacters. An author of "%" made the predicate `LIKE '%%%'`, matching
  // every row — which switched off the author half of the match on the
  // AUTO-APPLY path: imports.ts feeds this straight to applyRow and marks the
  // row `matched`/`title_author` with no review. A crafted CSV row could
  // therefore attach to whichever work shares the title and has the most
  // editions, regardless of who wrote it. Backslash is Postgres's default LIKE
  // escape, so the clause needs no ESCAPE addition.
  const authorPattern = `%${author.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const rows = await prisma.$queryRaw<{ olKey: string }[]>`
    SELECT ol_key AS "olKey"
    FROM catalog.works
    WHERE title_norm = lower(unaccent(${title}))
      AND coalesce(author_names_norm, '') LIKE lower(unaccent(${authorPattern}))
    ORDER BY edition_count DESC
    LIMIT 1
  `;
  return rows[0]?.olKey ?? null;
}

export interface RatingStats {
  average: number;
  count: number;
  /**
   * How many of `count` came from the CC-BY-SA corpus in `seed` rather than
   * from readers here.
   *
   * The column has always existed — its schema comment says it is there "so the
   * mix is auditable" — and nothing read it, so there was no way to tell how
   * much of a rating was borrowed. Attribution needs that answer, and so does
   * anyone deciding whether the corpus is still carrying the feature.
   */
  seedCount: number;
}

/**
 * Community rating for a work, read from the precomputed table rather than
 * aggregated per request. Null when nobody has rated it.
 */
export async function getWorkRating(
  workKey: string
): Promise<RatingStats | null> {
  const rows = await prisma.$queryRaw<RatingStats[]>`
    SELECT avg_rating AS average, rating_count AS count, seed_count AS "seedCount"
    FROM catalog.work_rating_stats WHERE work_key = ${workKey}
  `;
  return rows[0] ?? null;
}

/** Ratings for many works at once, for grids. */
export async function getWorkRatings(
  workKeys: string[]
): Promise<Map<string, RatingStats>> {
  const unique = [...new Set(workKeys)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const rows = await prisma.$queryRaw<(RatingStats & { workKey: string })[]>`
    SELECT work_key AS "workKey", avg_rating AS average, rating_count AS count,
           seed_count AS "seedCount"
    FROM catalog.work_rating_stats WHERE work_key = ANY(${unique})
  `;
  return new Map(
    rows.map((r) => [
      r.workKey,
      { average: r.average, count: r.count, seedCount: r.seedCount },
    ])
  );
}

/** A neighbour, plus how much of the pair came from the licensed corpus. */
export interface SimilarWork extends WorkSummary {
  /** Null for rows computed before provenance was recorded. */
  seedCoRaters: number | null;
}

/**
 * "Readers also enjoyed".
 *
 * Read from the precomputed similarity table — the co-occurrence self-join
 * behind it is not something to run while someone waits for a page. Returns an
 * empty list rather than throwing when a work has no neighbours yet, which is
 * the normal state on a thin ratings graph.
 *
 * `seedCoRaters` comes back so the page can decide whether CC BY-SA attribution
 * is owed. It used to be credited unconditionally, which over-claimed a viral
 * ShareAlike licence over readers' own reviews whenever the graph was built
 * without the corpus — the documented default. See SPEC-3.
 *
 * NULL sums to attribution rather than away from it: a row computed before the
 * column existed might contain corpus data, and the safe direction for a licence
 * is to credit.
 */
export async function getSimilarWorks(
  workKey: string,
  limit = 6
): Promise<SimilarWork[]> {
  return prisma.$queryRaw<SimilarWork[]>`
    SELECT w.ol_key             AS "olKey",
           w.title,
           w.author_names       AS "authorNames",
           w.first_publish_year AS "firstPublishYear",
           e.cover_id::int      AS "coverId",
           s.seed_co_raters     AS "seedCoRaters"
    FROM catalog.work_similarity s
    JOIN catalog.works w ON w.ol_key = s.similar_work_key
    LEFT JOIN catalog.editions e ON e.ol_key = w.cover_edition_key
    WHERE s.work_key = ${workKey}
    ORDER BY s.score DESC, s.co_raters DESC
    LIMIT ${limit}
  `;
}
