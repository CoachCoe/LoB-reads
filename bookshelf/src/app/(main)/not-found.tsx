import Link from "next/link";
import { Search } from "lucide-react";

/**
 * The 404 for everything under the main layout.
 *
 * Without this file, `notFound()` rendered Next's built-in page, which sits in
 * the ROOT layout — outside `(main)/layout.tsx` — so a reader got an unstyled
 * white page with no navbar, no footer, no search box and no way back.
 *
 * That matters more here than it usually would, because AGENTS.md's
 * missing-work invariant leans on this page being a reasonable destination:
 * "those render as 'not in the current catalog' and are not linked, BECAUSE
 * the work page 404s on a key the current slice lacks." Four public read paths
 * call notFound() — a work, an author, a shelf and a profile — and the most
 * common cause is not a bad link but a monthly ingest narrowing the slice.
 * So the copy says that rather than implying the reader made a mistake.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center">
      <Search
        className="mb-4 h-10 w-10 text-gray-400 dark:text-gray-500"
        aria-hidden="true"
      />
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        We could not find that
      </h1>
      <p className="mt-3 text-gray-600 dark:text-gray-400">
        This page may have moved, or the book may not be in the current
        catalog — it is rebuilt monthly from Open Library, and a title can drop
        out of the slice.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/search"
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
        >
          Search the catalog
        </Link>
        <Link
          href="/"
          className="rounded-lg border border-[var(--card-border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--card-bg)]"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
