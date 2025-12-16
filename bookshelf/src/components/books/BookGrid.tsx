import { Book } from "@prisma/client";
import BookCard from "./BookCard";

interface BookGridProps {
  books: (Book & {
    averageRating?: number;
    _count?: {
      reviews?: number;
      shelfItems?: number;
    };
  })[];
  emptyMessage?: string;
}

export default function BookGrid({
  books,
  emptyMessage = "No books found",
}: BookGridProps) {
  if (books.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-6xl mb-4">📚</div>
        <p className="text-gray-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {books.map((book) => (
        <BookCard key={book.id} book={book} />
      ))}
    </div>
  );
}
