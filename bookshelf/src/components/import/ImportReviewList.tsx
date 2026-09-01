"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import type { MatchCandidate } from "@/server/imports";

interface ReviewRow {
  id: string;
  rowNumber: number;
  title: string;
  author: string;
  myRating: number | null;
  exclusiveShelf: string | null;
  candidates: MatchCandidate[];
}

/**
 * The queue, one row at a time.
 *
 * Resolved rows disappear on success rather than waiting for a page refresh,
 * because the list is worked through in one sitting and a reload after every
 * choice loses your place. The server remains the record — a failure puts the
 * row back and says so.
 */
export default function ImportReviewList({ rows }: { rows: ReviewRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const remaining = rows.filter((r) => !resolved.has(r.id));

  /**
   * Whole URLs rather than a composed suffix. A path whose last segment is
   * interpolated cannot be resolved by static analysis, and conventions.test.ts
   * checks that every API path a component names resolves to a route exporting
   * the method it uses — the check that would have caught the M3 repoint
   * leaving these components on routes that had moved.
   */
  const actionUrl = {
    confirm: (rowId: string) => `/api/import/rows/${rowId}/confirm`,
    skip: (rowId: string) => `/api/import/rows/${rowId}/skip`,
  } as const;

  async function act(
    rowId: string,
    action: keyof typeof actionUrl,
    body?: object
  ) {
    setPending(rowId);
    setError(null);
    try {
      const response = await fetch(actionUrl[action](rowId), {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "That did not save. Try again.");
        return;
      }

      setResolved((prev) => new Set(prev).add(rowId));
      router.refresh();
    } catch {
      setError("That did not save. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  if (remaining.length === 0) {
    return (
      <p className="mt-8 text-sm text-gray-600 dark:text-gray-400">
        All done — reload to see the summary.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {remaining.map((row) => (
        <article
          key={row.id}
          className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
        >
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="font-medium text-gray-900 dark:text-gray-100">
                {row.title}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {row.author}
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
              {row.exclusiveShelf && <span>{shelfLabel(row.exclusiveShelf)}</span>}
              {row.myRating !== null && row.myRating > 0 && (
                <span className="flex items-center gap-1">
                  <Star
                    className="h-3.5 w-3.5 fill-current text-[#D4A017]"
                    aria-hidden="true"
                  />
                  {row.myRating}
                </span>
              )}
            </div>
          </header>

          {row.candidates.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {row.candidates.map((candidate) => (
                <li key={candidate.workKey}>
                  <button
                    type="button"
                    disabled={pending === row.id}
                    onClick={() =>
                      act(row.id, "confirm", { workKey: candidate.workKey })
                    }
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:border-[#0B6157] hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-gray-900 dark:text-gray-100">
                        {candidate.title}
                      </span>
                      <span className="block truncate text-gray-500 dark:text-gray-400">
                        {candidate.authorNames ?? "Unknown author"}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-[var(--foreground-secondary)]">
                      This one
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              Nothing in the catalog looks like this. It may be a book we do not
              hold yet.
            </p>
          )}

          <button
            type="button"
            disabled={pending === row.id}
            onClick={() => act(row.id, "skip")}
            className="mt-3 text-sm text-gray-500 underline hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {pending === row.id ? "Saving…" : "Set this one aside"}
          </button>
        </article>
      ))}
    </div>
  );
}

function shelfLabel(shelf: string): string {
  switch (shelf) {
    case "read":
      return "Read";
    case "currently-reading":
      return "Currently reading";
    case "to-read":
      return "Want to read";
    default:
      return shelf;
  }
}
