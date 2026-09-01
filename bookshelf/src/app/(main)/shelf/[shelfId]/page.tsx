import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { getShelfById, getShelfItemCount } from "@/server/shelves";
import { lastPageFor, resolvePage } from "@/lib/pagination";
import WorkGrid from "@/components/catalog/WorkGrid";
import Avatar from "@/components/ui/Avatar";

interface Props {
  params: Promise<{ shelfId: string }>;
  searchParams: Promise<{ page?: string }>;
}

const PAGE_SIZE = 100;

// Shelves are public, so this page renders for signed-out visitors too.
export default async function ShelfPage({ params, searchParams }: Props) {
  const { shelfId } = await params;
  const { page: requestedPage } = await searchParams;

  // The page used to call getShelfById with no options, take its default limit
  // of 100, and then render `shelf.itemCount` beside it — so an imported
  // 800-book shelf announced "800 books" and showed 100, with no way to reach
  // the rest.
  //
  // The count comes first because the page number has to be clamped against it
  // before there is an offset to fetch with.
  const itemCount = await getShelfItemCount(shelfId);
  const totalPages = lastPageFor(itemCount, PAGE_SIZE);
  const page = resolvePage(requestedPage, { lastPage: totalPages });

  const [shelf, currentUser] = await Promise.all([
    getShelfById(shelfId, {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    getCurrentUser(),
  ]);

  if (!shelf) {
    notFound();
  }

  const isOwnShelf = currentUser?.id === shelf.userId;
  

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {isOwnShelf && (
        <Link
          href="/my-books"
          className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to My Books
        </Link>
      )}

      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
        {shelf.name}
      </h1>

      <div className="flex items-center gap-2 mb-8 text-gray-500 dark:text-gray-400">
        {!isOwnShelf && (
          <Link
            href={`/user/${shelf.user.id}`}
            className="flex items-center gap-2 hover:text-gray-900 dark:hover:text-gray-100"
          >
            <Avatar src={shelf.user.avatarUrl} name={shelf.user.name} size="sm" />
            <span>{shelf.user.name}</span>
          </Link>
        )}
        <span>
          {!isOwnShelf && "· "}
          {shelf.itemCount} {shelf.itemCount === 1 ? "book" : "books"}
        </span>
      </div>

      <WorkGrid items={shelf.items} emptyMessage="No books on this shelf yet" />

      {totalPages > 1 && (
        <nav
          className="mt-8 flex items-center justify-center gap-3"
          aria-label="Shelf pages"
        >
          {page > 1 ? (
            <Link
              href={`/shelf/${shelfId}?page=${page - 1}`}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Previous
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}

          <span className="text-sm tabular-nums text-gray-500 dark:text-gray-400">
            Page {page} of {totalPages}
          </span>

          {page < totalPages && (
            <Link
              href={`/shelf/${shelfId}?page=${page + 1}`}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
