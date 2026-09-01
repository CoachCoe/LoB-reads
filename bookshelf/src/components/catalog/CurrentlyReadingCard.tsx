import Link from "next/link";
import ProgressBar from "@/components/ui/ProgressBar";
import CoverImage from "@/components/catalog/CoverImage";
import type { SessionWithWork } from "@/server/progress";

/** An open reading session, shown on the home page. */
export default function CurrentlyReadingCard({
  session,
}: {
  session: SessionWithWork;
}) {
  const title = session.work?.title ?? "Unknown work";

  return (
    <Link
      href={`/work/${session.workKey}`}
      className="flex gap-3 rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
    >
      <CoverImage
        title={session.work?.title ?? "Untitled"}
        olKey={session.workKey}
        coverId={session.work?.coverId}
        size="sm"
        sizes="64px"
        className="h-24 w-16 flex-shrink-0 rounded"
      />

      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 font-medium text-gray-900 dark:text-gray-100">
          {title}
        </h3>
        {session.work?.authorNames && (
          <p className="line-clamp-1 text-sm text-gray-500 dark:text-gray-400">
            {session.work.authorNames}
          </p>
        )}

        <div className="mt-2">
          {session.percent !== null ? (
            <>
              <ProgressBar value={session.percent} max={100} />
              <p className="mt-1 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                page {session.currentPage} of {session.pageCount} ·{" "}
                {session.percent}%
              </p>
            </>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              page {session.currentPage} · no page count for this edition
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
