import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { getShelfById } from "@/server/shelves";
import BookGrid from "@/components/books/BookGrid";
import Avatar from "@/components/ui/Avatar";

interface Props {
  params: Promise<{ shelfId: string }>;
}

// Shelves are public, so this page renders for signed-out visitors too.
export default async function ShelfPage({ params }: Props) {
  const { shelfId } = await params;
  const [shelf, currentUser] = await Promise.all([
    getShelfById(shelfId),
    getCurrentUser(),
  ]);

  if (!shelf) {
    notFound();
  }

  const isOwnShelf = currentUser?.id === shelf.userId;
  const books = shelf.shelfItems.map((item) => item.book);

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
          {books.length} {books.length === 1 ? "book" : "books"}
        </span>
      </div>

      <BookGrid books={books} emptyMessage="No books on this shelf yet" />
    </div>
  );
}
