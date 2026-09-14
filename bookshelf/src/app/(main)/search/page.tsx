import Link from "next/link";
import { Search as SearchIcon, Clock } from "lucide-react";
import {
  searchWorksPaged,
  getPopularWorks,
  getCatalogSubjects,
  getWorksBySubject,
  countWorksBySubject,
} from "@/server/catalog";
import { lastPageFor, resolvePage } from "@/lib/pagination";
import WorkCard from "@/components/catalog/WorkCard";
import SearchForm from "./SearchForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Discover books",
  description: "Search 6.9 million works from the Open Library catalog.",
};


interface Props {
  searchParams: Promise<{ q?: string; subject?: string; page?: string }>;
}

const PAGE_SIZE = 24;

/**
 * Search over the local Open Library catalog.
 *
 * This used to offer two tabs — books already in the local database, and a
 * live Open Library API search. The catalog makes that split meaningless:
 * it *is* Open Library, held locally, so there is one source and no network
 * call in the request path.
 */
export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const subject = (params.subject ?? "").trim();
  // Requested page, clamped below only. The upper bound needs the count, which
  // needs a query, so the real clamp happens once `total` is known.
  const requestedPage = params.page;

  // Three modes, and each asks the database a different question.
  //
  // A subject is a browse, not a search: subjects are not in search_vector,
  // because as a D-weighted term they made "Fiction" match 735,956 works and
  // ranking that many means reading every one. `subjects @> ARRAY[...]` is
  // indexed and answers what a chip is actually asking.
  //
  // The chips themselves are only rendered when there is nothing selected, so
  // they are only fetched then — asking for them regardless was most of this
  // page's latency before the counts were precomputed.
  const browsing = subject.length > 0;
  const searching = query.length > 0;

  // Searching resolves its count, page and rows in one call, because the arm it
  // picks decides all three and the fuzzy arm is too expensive to scan twice.
  // See searchWorksPaged.
  const searched = searching
    ? await searchWorksPaged(query, { pageSize: PAGE_SIZE, requestedPage })
    : null;

  const [total, subjects] = await Promise.all([
    browsing
      ? countWorksBySubject(subject)
      : searched
        ? Promise.resolve({ count: searched.count, atCeiling: searched.atCeiling })
        : Promise.resolve({ count: 0, atCeiling: false }),
    browsing || searching ? Promise.resolve<string[]>([]) : getCatalogSubjects(12),
  ]);

  // A search count stops at COUNT_CEILING, so no page beyond it has anything to
  // show. A subject browse has an exact count and an indexed lookup, so its own
  // total is the only honest bound.
  const totalPages = searched
    ? searched.totalPages
    : browsing
      ? lastPageFor(total.count, PAGE_SIZE)
      : 1;
  const page = searched
    ? searched.page
    : resolvePage(requestedPage, { lastPage: totalPages });
  const offset = (page - 1) * PAGE_SIZE;

  const works = browsing
    ? await getWorksBySubject(subject, { limit: PAGE_SIZE, offset })
    : searched
      ? searched.works
      : await getPopularWorks(PAGE_SIZE);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-100">
        {browsing ? subject : searching ? "Search results" : "Discover books"}
      </h1>

      <SearchForm initialQuery={query} />

      {!browsing && !searching && subjects.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {subjects.map((subject) => (
            <Link
              key={subject}
              href={`/search?subject=${encodeURIComponent(subject)}`}
              className="rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {subject}
            </Link>
          ))}
        </div>
      )}

      {/* Suppressed when the arm was abandoned: "No matches" is a claim about
          the catalog, and an abandoned search has not established one. */}
      {(browsing || searching) && !searched?.abandoned && (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          {total.count === 0
            ? "No matches"
            : `${total.count.toLocaleString()}${total.atCeiling ? "+" : ""} ${
                total.count === 1 ? "book" : "books"
              } ${browsing ? "in" : "for"} “${browsing ? subject : query}”`}
        </p>
      )}

      {works.length === 0 ? (
        <EmptyState
          query={browsing ? subject : query}
          abandoned={searched?.abandoned ?? false}
        />
      ) : (
        <>
          {!browsing && !searching && (
            <h2 className="mb-3 mt-8 text-lg font-semibold text-gray-900 dark:text-gray-100">
              Most published
            </h2>
          )}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {works.map((work) => (
              <WorkCard key={work.olKey} {...work} />
            ))}
          </div>
        </>
      )}

      {(browsing || searching) && totalPages > 1 && (
        <Pagination
          query={query}
          subject={subject}
          page={page}
          totalPages={totalPages}
        />
      )}
    </div>
  );
}

/**
 * MT-2. There are three reasons this page can be empty and they are not the
 * same thing:
 *
 *   - nothing was searched for yet, and the catalog is empty
 *   - the search ran and found nothing
 *   - the search RAN OUT OF TIME and was cancelled
 *
 * The third used to render as the second, so a reader searching "the hobbitt" —
 * a real typo with 20 real matches, and the exact query the fuzzy arm exists
 * to rescue — was told to check their spelling. It is the one case worth
 * retrying, and the only one where the reader did nothing wrong.
 */
function EmptyState({
  query,
  abandoned,
}: {
  query: string;
  abandoned: boolean;
}) {
  if (!query) {
    return (
      <div className="py-16 text-center">
        <SearchIcon
          className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600"
          aria-hidden="true"
        />
        <p className="text-gray-600 dark:text-gray-400">
          No books to show yet — please check back shortly.
        </p>
      </div>
    );
  }

  if (abandoned) {
    return (
      <div className="py-16 text-center">
        <Clock
          className="mx-auto mb-3 h-10 w-10 text-[var(--color-primary)]"
          aria-hidden="true"
        />
        <p className="text-[var(--foreground)]">
          That search took too long, so we stopped it.
        </p>
        <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
          It is us, not your spelling — near-matches over 6.9 million books are
          slow for some words. Trying again often works.
        </p>
        <Link
          href={`/search?q=${encodeURIComponent(query)}`}
          className="mt-5 inline-block rounded-lg bg-[var(--color-primary)] px-5 py-2.5 font-medium text-[var(--color-primary-contrast)] hover:bg-[var(--color-primary-dark)]"
        >
          Try again
        </Link>
      </div>
    );
  }

  return (
    <div className="py-16 text-center">
      <SearchIcon
        className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600"
        aria-hidden="true"
      />
      <p className="text-gray-600 dark:text-gray-400">
        Nothing matched “{query}”.
      </p>
      <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
        Try fewer words, or check the spelling.
      </p>
    </div>
  );
}

function Pagination({
  query,
  subject,
  page,
  totalPages,
}: {
  query: string;
  subject: string;
  page: number;
  totalPages: number;
}) {
  // Carry whichever mode brought the reader here, or paging drops them back
  // into an unfiltered search.
  const href = (n: number) =>
    subject
      ? `/search?subject=${encodeURIComponent(subject)}&page=${n}`
      : `/search?q=${encodeURIComponent(query)}&page=${n}`;
  // Display cap only: paging deeper still works by URL, and the resolver bounds
  // it against the real total. 50 pages of 24 is more than anyone scrolls.
  const capped = Math.min(totalPages, 50);

  return (
    <nav
      className="mt-8 flex items-center justify-center gap-3"
      aria-label="Search results pages"
    >
      {page > 1 ? (
        <Link
          href={href(page - 1)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Previous
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}

      <span className="text-sm tabular-nums text-gray-500 dark:text-gray-400">
        Page {page} of {capped}
      </span>

      {page < capped && (
        <Link
          href={href(page + 1)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Next
        </Link>
      )}
    </nav>
  );
}
