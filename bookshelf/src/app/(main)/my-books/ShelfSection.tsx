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
          <h2 className="text-xl font-bold text-[var(--foreground)]">{shelf.name}</h2>
          <span className="text-sm text-[var(--foreground-secondary)]">({bookCount})</span>
        </div>
        {bookCount > 6 && (
          <Link
            href={`/shelf/${shelf.id}`}
            className="text-sm text-[#D4A017] hover:text-[#B8860B] flex items-center gap-1"
          >
            View all
            <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {bookCount === 0 ? (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg py-8 text-center">
          <p className="text-[var(--foreground-secondary)]">No books on this shelf yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {displayBooks.map((item) => (
            <div key={item.id} className="group relative">
              <Link href={`/book/${item.bookId}`}>
                <div className="bg-[var(--card-bg)] rounded-lg shadow-sm border border-[var(--card-border)] overflow-hidden hover:shadow-md transition-shadow">
                  <div className="aspect-[2/3] relative bg-[var(--border-light)]">
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
                      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-purple-500/20 to-pink-500/20">
                        <span className="text-3xl">📚</span>
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <h3 className="font-medium text-sm text-[var(--foreground)] line-clamp-1">
                      {item.book.title}
                    </h3>
                    <p className="text-xs text-[var(--foreground-secondary)] line-clamp-1">
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
                className="absolute top-2 right-2 p-1.5 bg-[var(--card-bg)] rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/10"
                title="Remove from shelf"
              >
                <X className="h-4 w-4 text-[var(--foreground-secondary)] hover:text-red-500" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
