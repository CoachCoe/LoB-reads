import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { getImportSession, getRowsForReview } from "@/server/imports";
import ImportReviewList from "@/components/import/ImportReviewList";

interface Props {
  params: Promise<{ sessionId: string }>;
}

/**
 * The review queue for one import.
 *
 * Private, unlike shelves: an import is a reader's raw history, including
 * books they may never shelve.
 */
export default async function ImportReviewPage({ params }: Props) {
  const { sessionId } = await params;
  const user = await getCurrentUser();
  if (!user?.id) {
    redirect("/login");
  }

  const summary = await getImportSession(user.id, sessionId);
  if (!summary) {
    notFound();
  }

  const rows = await getRowsForReview(user.id, sessionId);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href="/settings"
        className="mb-6 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to settings
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        Review your import
      </h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        {summary.filename} — {summary.matched} of {summary.totalRows} books
        matched automatically ({summary.matchRate}%).
      </p>

      {rows.length === 0 ? (
        <div className="mt-10 rounded-lg border border-gray-200 py-12 text-center dark:border-gray-700">
          <CheckCircle2
            className="mx-auto mb-3 h-10 w-10 text-green-500"
            aria-hidden="true"
          />
          <p className="font-medium text-gray-900 dark:text-gray-100">
            Nothing left to review.
          </p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {summary.confirmed > 0 &&
              `You matched ${summary.confirmed} by hand. `}
            {summary.skipped > 0 && `${summary.skipped} were set aside.`}
          </p>
          <Link
            href="/my-books"
            className="mt-4 inline-block rounded-lg bg-[#D4A017] px-5 py-2 text-sm font-medium text-[var(--color-primary-contrast)] hover:bg-[#B8860B]"
          >
            Go to my books
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-6 text-sm text-gray-600 dark:text-gray-400">
            These {rows.length === 1 ? "book" : "books"} did not match exactly.
            Usually the title in your export differs slightly from ours. Pick
            the right one, or set it aside — nothing here is applied until you
            choose.
          </p>
          <ImportReviewList rows={rows} />
        </>
      )}
    </div>
  );
}
