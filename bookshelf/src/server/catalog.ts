import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/**
 * Reads over the Open Library catalog.
 *
 * Raw SQL rather than Prisma: the search ranking needs `ts_rank_cd`,
 * `similarity()` and a weighted expression that Prisma cannot express, and the
 * `search_vector` column has no Prisma type at all.
 *
 * `unaccent()` is applied on BOTH sides. The index stores the unaccented form,
 * so querying the raw form matches nothing — searching "Miserables" would miss
 * "Les Misérables" entirely, silently.
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

export async function searchWorks(
  query: string,
  { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<WorkSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  // `websearch_to_tsquery` handles quoted phrases and OR without throwing on
  // punctuation the way `to_tsquery` does with raw user input.
  return prisma.$queryRaw<WorkSearchResult[]>`
    WITH q AS (
      SELECT
        websearch_to_tsquery('english', unaccent(${trimmed})) AS tsq,
        unaccent(lower(${trimmed}))                           AS norm
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
          (CASE WHEN unaccent(lower(w.title)) = q.norm THEN ${W_EXACT} ELSE 0 END)
        + (CASE WHEN unaccent(lower(w.title)) LIKE q.norm || '%' THEN ${W_PREFIX} ELSE 0 END)
        + ts_rank_cd(w.search_vector, q.tsq) * ${W_FTS}
        + similarity(unaccent(lower(w.title)), q.norm) * ${W_TRIGRAM}
        + ln(1 + w.edition_count) * ${W_POPULARITY}
      )::double precision                        AS rank
    FROM catalog.works w
    CROSS JOIN q
    LEFT JOIN catalog.editions e ON e.ol_key = w.cover_edition_key
    WHERE w.search_vector @@ q.tsq
       OR unaccent(lower(w.title)) % q.norm
    ORDER BY rank DESC, w.edition_count DESC, w.ol_key
    LIMIT ${limit} OFFSET ${offset}
  `;
}

/** Total matches, for pagination. Deliberately a separate query. */
export async function countWorkMatches(query: string): Promise<number> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return 0;

  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    WITH q AS (
      SELECT
        websearch_to_tsquery('english', unaccent(${trimmed})) AS tsq,
        unaccent(lower(${trimmed}))                           AS norm
    )
    SELECT count(*) AS count
    FROM catalog.works w
    CROSS JOIN q
    WHERE w.search_vector @@ q.tsq
       OR unaccent(lower(w.title)) % q.norm
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function getWorkByKey(olKey: string): Promise<WorkDetail | null> {
  const [work] = await prisma.$queryRaw<
    Array<Omit<WorkDetail, "authors" | "editions">>
  >`
    SELECT
      ol_key               AS "olKey",
      title,
      subtitle,
      description,
      first_publish_year   AS "firstPublishYear",
      subjects,
      edition_count        AS "editionCount",
      cover_edition_key    AS "coverEditionKey"
    FROM catalog.works
    WHERE ol_key = ${olKey}
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

/**
 * Cover image URL for a work or edition.
 *
 * Prefer the `id` form: we already hold `cover_id`, and the `isbn` form is
 * more aggressively rate limited. These are hotlinked for now; before any real
 * traffic they should be fetched once and served from our own storage, misses
 * cached included.
 */
export function coverUrl(
  coverId: number | null | undefined,
  size: "S" | "M" | "L" = "M"
): string | null {
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg` : null;
}

/** Browse entry point: the works with the most editions. */
export async function getPopularWorks(limit = 24): Promise<WorkSearchResult[]> {
  return prisma.$queryRaw<WorkSearchResult[]>`
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

/** Distinct subjects across the catalog, for browse filters. */
export async function getCatalogSubjects(limit = 40): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ subject: string }[]>`
    SELECT subject, count(*) AS n
    FROM catalog.works, unnest(subjects) AS subject
    GROUP BY subject
    ORDER BY n DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.subject);
}

/** Kept for the explain-plan check in the performance test. */
export const SEARCH_SQL_MARKER = Prisma.sql`catalog.works`;
