import Link from "next/link";
import { Search as SearchIcon } from "lucide-react";
import {
  searchWorks,
  countWorkMatches,
  getPopularWorks,
  getCatalogSubjects,
  getWorksBySubject,
  countWorksBySubject,
  COUNT_CEILING,
} from "@/server/catalog";
import { resolvePage } from "@/lib/pagination";
import WorkCard from "@/components/catalog/WorkCard";
import SearchForm from "./SearchForm";

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
  // Clamped at both ends. See resolvePage: the old form bounded only the
  // bottom, so a typed ?page=1e8 became OFFSET 2399999976.
  const page = resolvePage(params.page, {
    pageSize: PAGE_SIZE,
    ceiling: COUNT_CEILING,
  });
  const offset = (page - 1) * PAGE_SIZE;

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

  const [works, total, subjects] = await Promise.all([
    browsing
      ? getWorksBySubject(subject, { limit: PAGE_SIZE, offset })
      : searching
        ? searchWorks(query, { limit: PAGE_SIZE, offset })
        : getPopularWorks(PAGE_SIZE),
    browsing
      ? countWorksBySubject(subject)
      : searching
        ? countWorkMatches(query)
        : Promise.resolve({ count: 0, atCeiling: false }),
    browsing || searching ? Promise.resolve<string[]>([]) : getCatalogSubjects(12),
  ]);

  const totalPages =
    browsing || searching ? Math.ceil(total.count / PAGE_SIZE) : 1;

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

      {(browsing || searching) && (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          {total.count === 0
            ? "No matches"
            : `${total.count.toLocaleString()}${total.atCeiling ? "+" : ""} ${
                total.count === 1 ? "book" : "books"
              } ${browsing ? "in" : "for"} “${browsing ? subject : query}”`}
        </p>
      )}

      {works.length === 0 ? (
        <EmptyState query={browsing ? subject : query} />
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

function EmptyState({ query }: { query: string }) {
  return (
    <div className="py-16 text-center">
      <SearchIcon
        className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600"
        aria-hidden="true"
      />
      <p className="text-gray-600 dark:text-gray-400">
        {query
          ? `Nothing matched “${query}”.`
          : "The catalog is empty — run the ingest to populate it."}
      </p>
      {query && (
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-500">
          Try fewer words, or check the spelling.
        </p>
      )}
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
