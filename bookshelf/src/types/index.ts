import type { User, Shelf, ShelfItem, Review, Follow } from "@prisma/client";

// Re-export Prisma types
export type { User, Shelf, ShelfItem, Review, Follow };

/**
 * The subset of a user that may be shown to anyone. Prefer this over `User`
 * in anything that reaches a response — `User` spreads the Prisma row, so it
 * carries `email` and `passwordHash` by default.
 */
export type PublicUser = Pick<User, "id" | "name" | "avatarUrl">;

// Review with its author's public fields
export type ReviewWithUser = Review & {
  user: PublicUser;
};

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
