"use client";

import { coverUrl } from "@/lib/covers";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronRight, X } from "lucide-react";
import type { ShelfWithItems } from "@/server/shelves";
import { useToast } from "@/components/providers/ToastProvider";

interface ShelfSectionProps {
  shelf: ShelfWithItems;
}

export default function ShelfSection({ shelf }: ShelfSectionProps) {
  const [items, setItems] = useState(shelf.items);
  const [removing, setRemoving] = useState<string | null>(null);
  // The true total, not `items.length`. `items` is capped at
  // SHELF_PREVIEW_SIZE, so a 42-book shelf used to render "(24)" while
  // my-books/page.tsx used `itemCount` correctly two elements away.
  const [bookCount, setBookCount] = useState(shelf.itemCount);
  const { showToast } = useToast();

  // The endpoint is /works and the body key is workKey. This called /books
  // with { bookId } — the pre-M3 contract, which returns 404: the repoint from
  // app.books to work_key moved the route and left the caller behind. Removing
  // a book from a shelf has been silently failing on this page since.
  const handleRemove = async (workKey: string) => {
    setRemoving(workKey);
    try {
      const response = await fetch(`/api/shelves/${shelf.id}/works`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workKey }),
      });

      if (!response.ok) {
        // This branch is why the pre-M3 404 went unnoticed for three
        // milestones: the handler acted only on `response.ok`, so a route that
        // had moved looked exactly like a successful removal.
        const data = await response.json().catch(() => ({}));
        showToast(data.error ?? "Could not remove that book", "error");
        return;
      }

      setItems(items.filter((item) => item.workKey !== workKey));
      setBookCount((count) => Math.max(0, count - 1));
    } catch {
      showToast("Could not reach the server. Try again.", "error");
    } finally {
      setRemoving(null);
    }
  };

  const displayBooks = items.slice(0, 6);

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-[var(--foreground)]">{shelf.name}</h2>
          <span className="text-sm text-[var(--foreground-secondary)]">({bookCount})</span>
        </div>
        {/* Was `bookCount > 6`, so a shelf of two books had no route to its
            own page. FLOW-15: the public shelf page was reachable from almost
            nowhere. */}
        {bookCount > displayBooks.length && (
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
              <Link href={`/work/${item.workKey}`}>
                <div className="bg-[var(--card-bg)] rounded-lg shadow-sm border border-[var(--card-border)] overflow-hidden hover:shadow-md transition-shadow">
                  <div className="aspect-[2/3] relative bg-[var(--border-light)]">
                    {coverUrl(item.work?.coverId) ? (
                      <Image
                        src={coverUrl(item.work?.coverId) ?? ""}
                        alt={item.work?.title ?? "Not in the current catalog"}
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
                      {item.work?.title ?? "Not in the current catalog"}
                    </h3>
                    <p className="text-xs text-[var(--foreground-secondary)] line-clamp-1">
                      {item.work?.authorNames ?? ""}
                    </p>
                  </div>
                </div>
              </Link>

              {/* Remove button */}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  handleRemove(item.workKey);
                }}
                disabled={removing === item.workKey}
                className="absolute top-2 right-2 p-1.5 bg-[var(--card-bg)] rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/10"
                title="Remove from shelf"
                aria-label={`Remove ${item.work?.title ?? "Not in the current catalog"} from this shelf`}
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
