"use client";

import { useState } from "react";
import type { WorkEdition } from "@/server/catalog";

interface EditionListProps {
  workKey: string;
  initialEditions: WorkEdition[];
  totalCount: number;
  pageSize: number;
}

/**
 * Editions of a work, loaded a page at a time.
 *
 * A popular work can carry hundreds of editions, so the page ships the first
 * batch and fetches more on demand rather than rendering the lot.
 */
export default function EditionList({
  workKey,
  initialEditions,
  totalCount,
  pageSize,
}: EditionListProps) {
  const [editions, setEditions] = useState(initialEditions);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const remaining = totalCount - editions.length;

  const loadMore = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(
        `/api/works/${workKey}/editions?offset=${editions.length}&limit=${pageSize}`
      );
      if (!res.ok) throw new Error(String(res.status));
      const more: WorkEdition[] = await res.json();
      setEditions((current) => [...current, ...more]);
    } catch (error) {
      console.error("Failed to load more editions:", error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  if (editions.length === 0) {
    return (
      <p className="text-gray-500 dark:text-gray-400">
        No editions recorded for this work.
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
              <th className="py-2 pr-4 font-medium">Published</th>
              <th className="py-2 pr-4 font-medium">Publisher</th>
              <th className="py-2 pr-4 font-medium">Format</th>
              <th className="py-2 pr-4 font-medium">Pages</th>
              <th className="py-2 font-medium">ISBN</th>
            </tr>
          </thead>
          <tbody>
            {editions.map((edition) => (
              <tr
                key={edition.olKey}
                className="border-b border-gray-100 text-gray-700 dark:border-gray-800 dark:text-gray-300"
              >
                <td className="py-2 pr-4 tabular-nums">
                  {/* The raw string is shown when it could not be parsed to a
                      year — "n.d." is more honest than a blank cell. */}
                  {edition.publishYear ?? edition.publishDateRaw ?? "—"}
                </td>
                <td className="py-2 pr-4">{edition.publishers[0] ?? "—"}</td>
                <td className="py-2 pr-4">{edition.physicalFormat ?? "—"}</td>
                <td className="py-2 pr-4 tabular-nums">
                  {edition.numberOfPages ?? "—"}
                </td>
                <td className="py-2 font-mono text-xs">
                  {edition.isbn13 ?? edition.isbn10 ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {remaining > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {loading ? "Loading…" : `Show ${Math.min(remaining, pageSize)} more`}
          </button>
          {failed && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              Could not load more editions. Try again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
