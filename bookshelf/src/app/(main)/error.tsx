"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/**
 * The error boundary for everything under the main layout.
 *
 * Same reason as not-found.tsx: without it an unhandled render error fell
 * through to Next's built-in page in the root layout, so a reader lost the
 * navbar, the footer and any way back. A client component, because an error
 * boundary has to be one.
 *
 * `reset` re-renders the segment, which is the right first move for a
 * transient failure — a probe timing out, a database connection dropped
 * mid-render — and those are the failures this app actually has.
 *
 * The error itself is not shown. `errorResponse` already refuses to put a
 * Prisma message into a response, for the same reason: they name constraints
 * and columns.
 */
export default function MainError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center">
      <AlertTriangle
        className="mb-4 h-10 w-10 text-gray-400 dark:text-gray-500"
        aria-hidden="true"
      />
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        Something went wrong
      </h1>
      <p className="mt-3 text-gray-600 dark:text-gray-400">
        This one is on us. Trying again often works.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
        >
          Try again
        </button>
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
