"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search as SearchIcon } from "lucide-react";

/**
 * A plain form that navigates. Search results are server-rendered, so there is
 * no reason to fetch and re-render on the client — this keeps the URL
 * shareable and the back button meaningful.
 */
export default function SearchForm({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search");
      }}
      className="flex gap-2"
    >
      <div className="relative flex-1">
        <SearchIcon
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          aria-hidden="true"
        />
        <input
          type="search"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search by title, author or subject"
          aria-label="Search the book catalog"
          className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-gray-900 placeholder-gray-400 focus:border-[#0B6157] focus:outline-none focus:ring-1 focus:ring-[#0B6157] dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
        />
      </div>
      <button
        type="submit"
        className="rounded-lg bg-[#D4A017] px-5 py-2.5 font-medium text-white transition-colors hover:bg-[#B8860B]"
      >
        Search
      </button>
    </form>
  );
}
