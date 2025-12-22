"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Search, Plus, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { Book } from "@prisma/client";
import BookGrid from "@/components/books/BookGrid";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";

interface SearchPageClientProps {
  initialBooks: Book[];
  initialQuery: string;
  genres: string[];
  selectedGenre?: string;
}

interface OpenLibraryBook {
  title: string;
  author: string;
  isbn: string | null;
  coverUrl: string | null;
  pageCount: number | null;
  publishedDate: string | null;
  genres: string[];
  openLibraryId: string;
}

export default function SearchPageClient({
  initialBooks,
  initialQuery,
  genres,
  selectedGenre,
}: SearchPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  const [query, setQuery] = useState(initialQuery);
  const [localBooks, setLocalBooks] = useState(initialBooks);
  const [openLibraryBooks, setOpenLibraryBooks] = useState<OpenLibraryBook[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<"local" | "openlibrary">("local");
  const [importingBook, setImportingBook] = useState<string | null>(null);

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setOpenLibraryBooks([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(
        `/api/books?q=${encodeURIComponent(searchQuery)}&source=all`
      );
      if (response.ok) {
        const data = await response.json();
        setLocalBooks(data.local || []);
        setOpenLibraryBooks(data.openLibrary || []);
      }
    } catch (error) {
      console.error("Search failed:", error);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (initialQuery) {
      handleSearch(initialQuery);
    }
  }, [initialQuery, handleSearch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(`/search?q=${encodeURIComponent(query)}`);
    handleSearch(query);
  };

  const handleGenreClick = (genre: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("genre") === genre) {
      params.delete("genre");
    } else {
      params.set("genre", genre);
    }
    router.push(`/search?${params.toString()}`);
  };

  const handleImportBook = async (book: OpenLibraryBook) => {
    if (!session?.user) return;

    setImportingBook(book.openLibraryId);
    try {
      const response = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(book),
      });

      if (response.ok) {
        const newBook = await response.json();
        router.push(`/book/${newBook.id}`);
      }
    } catch (error) {
      console.error("Import failed:", error);
    } finally {
      setImportingBook(null);
    }
  };

  const filteredBooks = selectedGenre
    ? localBooks.filter((book) => book.genres.includes(selectedGenre))
    : localBooks;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Search form */}
      <form onSubmit={handleSubmit} className="mb-8">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for books by title, author, or ISBN..."
            className="w-full pl-12 pr-4 py-3 text-lg border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
          />
          {isSearching && (
            <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 animate-spin" />
          )}
        </div>
      </form>

      {/* Genre filter */}
      {genres.length > 0 && (
        <div className="mb-6">
          <div className="flex flex-wrap gap-2">
            {genres.slice(0, 10).map((genre) => (
              <button
                key={genre}
                onClick={() => handleGenreClick(genre)}
                className={`px-3 py-1 rounded-full text-sm transition-colors ${
                  selectedGenre === genre
                    ? "bg-amber-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {genre}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      {query && (
        <div className="flex gap-4 mb-6 border-b border-gray-200">
          <button
            onClick={() => setActiveTab("local")}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "local"
                ? "border-amber-600 text-amber-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            In Library ({localBooks.length})
          </button>
          <button
            onClick={() => setActiveTab("openlibrary")}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "openlibrary"
                ? "border-amber-600 text-amber-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Open Library ({openLibraryBooks.length})
          </button>
        </div>
      )}

      {/* Results */}
      {activeTab === "local" ? (
        <BookGrid
          books={filteredBooks}
          emptyMessage={
            query
              ? "No books found in library. Try searching Open Library!"
              : "Browse our book catalog"
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {openLibraryBooks.map((book) => (
            <OpenLibraryBookCard
              key={book.openLibraryId}
              book={book}
              onImport={() => handleImportBook(book)}
              isImporting={importingBook === book.openLibraryId}
              isLoggedIn={!!session?.user}
            />
          ))}
          {openLibraryBooks.length === 0 && query && (
            <div className="col-span-full text-center py-12 text-gray-500">
              No results from Open Library
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OpenLibraryBookCard({
  book,
  onImport,
  isImporting,
  isLoggedIn,
}: {
  book: OpenLibraryBook;
  onImport: () => void;
  isImporting: boolean;
  isLoggedIn: boolean;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex gap-4">
        {book.coverUrl ? (
          <Image
            src={book.coverUrl}
            alt={book.title}
            width={80}
            height={112}
            className="w-20 h-28 object-cover rounded"
            unoptimized
          />
        ) : (
          <div className="w-20 h-28 bg-gradient-to-br from-amber-100 to-orange-100 rounded flex items-center justify-center">
            <span className="text-2xl">📚</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 line-clamp-2">
            {book.title}
          </h3>
          <p className="text-sm text-gray-500 truncate">{book.author}</p>
          {book.publishedDate && (
            <p className="text-xs text-gray-400">{book.publishedDate}</p>
          )}
          {book.genres.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {book.genres.slice(0, 2).map((genre) => (
                <Badge key={genre} variant="default" className="text-xs">
                  {genre}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
      {isLoggedIn && (
        <Button
          onClick={onImport}
          variant="outline"
          size="sm"
          className="w-full mt-3"
          isLoading={isImporting}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add to Library
        </Button>
      )}
    </div>
  );
}
