"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronRight, X } from "lucide-react";
import { ShelfWithBooks } from "@/types";

interface ShelfSectionProps {
  shelf: ShelfWithBooks;
}

export default function ShelfSection({ shelf }: ShelfSectionProps) {
  const [items, setItems] = useState(shelf.shelfItems);
  const [removingBook, setRemovingBook] = useState<string | null>(null);

  const handleRemoveBook = async (bookId: string) => {
    setRemovingBook(bookId);
    try {
      const response = await fetch(`/api/shelves/${shelf.id}/books`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId }),
      });

      if (response.ok) {
        setItems(items.filter((item) => item.bookId !== bookId));
      }
    } catch (error) {
      console.error("Failed to remove book:", error);
    } finally {
      setRemovingBook(null);
    }
  };

  const bookCount = items.length;
  const displayBooks = items.slice(0, 6);

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-gray-900">{shelf.name}</h2>
          <span className="text-sm text-gray-500">({bookCount})</span>
        </div>
        {bookCount > 6 && (
          <Link
            href={`/shelf/${shelf.id}`}
            className="text-sm text-amber-600 hover:text-amber-700 flex items-center gap-1"
          >
            View all
            <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {bookCount === 0 ? (
        <div className="bg-gray-50 rounded-lg py-8 text-center">
          <p className="text-gray-500">No books on this shelf yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {displayBooks.map((item) => (
            <div key={item.id} className="group relative">
              <Link href={`/book/${item.bookId}`}>
                <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
                  <div className="aspect-[2/3] relative bg-gray-100">
                    {item.book.coverUrl ? (
                      <Image
                        src={item.book.coverUrl}
                        alt={item.book.title}
                        fill
                        className="object-cover"
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
                        unoptimized
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-amber-100 to-orange-100">
                        <span className="text-3xl">📚</span>
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <h3 className="font-medium text-sm text-gray-900 line-clamp-1">
                      {item.book.title}
                    </h3>
                    <p className="text-xs text-gray-500 line-clamp-1">
                      {item.book.author}
                    </p>
                  </div>
                </div>
              </Link>

              {/* Remove button */}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  handleRemoveBook(item.bookId);
                }}
                disabled={removingBook === item.bookId}
                className="absolute top-2 right-2 p-1.5 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
                title="Remove from shelf"
              >
                <X className="h-4 w-4 text-gray-500 hover:text-red-500" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
