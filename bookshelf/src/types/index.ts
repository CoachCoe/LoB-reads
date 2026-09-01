import type { User, Shelf, ShelfItem, Review, Follow } from "@prisma/client";

// Re-export Prisma types
export type { User, Shelf, ShelfItem, Review, Follow };

// `PublicUser` and `ReviewWithUser` lived here with no consumer anywhere.
// PublicUser's comment stated a policy — "prefer this over User in anything that
// reaches a response" — that nothing imported and nothing enforced; the real
// projection is `publicUserSelect` in src/server/users.ts. Removed rather than
// left as documentation of a rule the code does not follow.

// Open Library API types
export interface OpenLibraryBook {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  cover_i?: number;
  number_of_pages_median?: number;
  subject?: string[];
}

export interface OpenLibrarySearchResponse {
  numFound: number;
  start: number;
  docs: OpenLibraryBook[];
}
