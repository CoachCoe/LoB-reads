import Link from "next/link";
import { Search } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

/**
 * The 404 for the whole app.
 *
 * At `app/` and not `app/(main)/`, and it renders the navbar and footer itself.
 * Both are deliberate, and neither was my first attempt — the first version
 * sat in the route group and expected `(main)/layout.tsx` to supply the chrome.
 * It does not: Next's own reference for this file says a `not-found.js`
 * "renders inside your root layout", so a group-level copy got the root layout
 * and no navbar. Measured before believing it — the group version's markup
 * appeared only in the RSC payload while the served HTML was Next's built-in
 * shell.
 *
 * Without this file, `notFound()` on the four public read paths — a work, an
 * author, a shelf, a profile — rendered that built-in page: unstyled, no
 * navigation, no search box, no way back. AGENTS.md's missing-work invariant
 * leans on this page being a reasonable destination, since it is what a reader
 * reaches when a monthly ingest narrows the slice and drops a work someone has
 * shelved. That is the common case, not a mistyped URL, so the copy says so.
 *
 * The two components are rendered here rather than the layout being reused,
 * because reusing it is not available at this level. That is a real
 * duplication of two lines and it is the smaller cost.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-[var(--background)] flex flex-col">
      <Navbar />
      <main className="flex-1">
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
            catalog — it is rebuilt monthly from Open Library, and a title can
            drop out of the slice.
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
      </main>
      <Footer />
    </div>
  );
}
