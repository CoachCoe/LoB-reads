import { Suspense } from "react";
import { searchLocalBooks, getAllGenres } from "@/server/books";
import SearchPageClient from "./SearchPageClient";

interface Props {
  searchParams: Promise<{ q?: string; genre?: string }>;
}

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = params.q || "";
  const genre = params.genre;

  const [localBooks, genres] = await Promise.all([
    query ? searchLocalBooks(query, 20) : searchLocalBooks("", 50),
    getAllGenres(),
  ]);

  return (
    <Suspense fallback={<SearchLoading />}>
      <SearchPageClient
        initialBooks={localBooks}
        initialQuery={query}
        genres={genres}
        selectedGenre={genre}
      />
    </Suspense>
  );
}

function SearchLoading() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="animate-pulse">
        <div className="h-12 bg-gray-200 rounded-lg mb-8" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i}>
              <div className="aspect-[2/3] bg-gray-200 rounded-lg mb-2" />
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-1" />
              <div className="h-3 bg-gray-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
