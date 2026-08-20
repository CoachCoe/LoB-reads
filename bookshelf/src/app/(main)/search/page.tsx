import Link from "next/link";
import { Search as SearchIcon } from "lucide-react";
import {
  searchWorks,
  countWorkMatches,
  getPopularWorks,
  getCatalogSubjects,
} from "@/server/catalog";
import WorkCard from "@/components/catalog/WorkCard";
import SearchForm from "./SearchForm";

interface Props {
  searchParams: Promise<{ q?: string; page?: string }>;
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
  const page = Math.max(1, Number(params.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Subjects are only rendered when there is no query, so only fetch them
  // then. Fetching regardless meant every search paid for a result it threw
  // away — which was most of the page's latency before the counts were
  // precomputed, and is still pointless work now that they are.
  const [works, total, subjects] = await Promise.all([
    query
      ? searchWorks(query, { limit: PAGE_SIZE, offset })
      : getPopularWorks(PAGE_SIZE),
    query
      ? countWorkMatches(query)
      : Promise.resolve({ count: 0, atCeiling: false }),
    query ? Promise.resolve<string[]>([]) : getCatalogSubjects(12),
  ]);

  const totalPages = query ? Math.ceil(total.count / PAGE_SIZE) : 1;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-100">
        {query ? "Search results" : "Discover books"}
      </h1>

      <SearchForm initialQuery={query} />

      {!query && subjects.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {subjects.map((subject) => (
            <Link
              key={subject}
              href={`/search?q=${encodeURIComponent(subject)}`}
              className="rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {subject}
            </Link>
          ))}
        </div>
      )}

      {query && (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          {total.count === 0
            ? "No matches"
            : `${total.count.toLocaleString()}${total.atCeiling ? "+" : ""} ${
                total.count === 1 ? "result" : "results"
              } for “${query}”`}
        </p>
      )}

      {works.length === 0 ? (
        <EmptyState query={query} />
      ) : (
        <>
          {!query && (
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

      {query && totalPages > 1 && (
        <Pagination query={query} page={page} totalPages={totalPages} />
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
  page,
  totalPages,
}: {
  query: string;
  page: number;
  totalPages: number;
}) {
  const href = (n: number) =>
    `/search?q=${encodeURIComponent(query)}&page=${n}`;
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
