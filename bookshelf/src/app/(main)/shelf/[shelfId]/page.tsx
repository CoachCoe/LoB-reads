import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { getShelfById } from "@/server/shelves";
import BookGrid from "@/components/books/BookGrid";

interface Props {
  params: Promise<{ shelfId: string }>;
}

export default async function ShelfPage({ params }: Props) {
  const { shelfId } = await params;
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const shelf = await getShelfById(shelfId);

  if (!shelf) {
    notFound();
  }

  // Only allow users to view their own shelves
  if (shelf.userId !== user.id) {
    notFound();
  }

  const books = shelf.shelfItems.map((item) => item.book);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <Link
        href="/my-books"
        className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to My Books
      </Link>

      <h1 className="text-3xl font-bold text-gray-900 mb-2">{shelf.name}</h1>
      <p className="text-gray-500 mb-8">{books.length} books</p>

      <BookGrid
        books={books}
        emptyMessage="No books on this shelf yet"
      />
    </div>
  );
}
