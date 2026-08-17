import type { User, Book, Shelf, ShelfItem, Review, ReadingProgress, Follow } from "@prisma/client";

// Re-export Prisma types
export type { User, Book, Shelf, ShelfItem, Review, ReadingProgress, Follow };

/**
 * The subset of a user that may be shown to anyone. Prefer this over `User`
 * in anything that reaches a response — `User` spreads the Prisma row, so it
 * carries `email` and `passwordHash` by default.
 */
export type PublicUser = Pick<User, "id" | "name" | "avatarUrl">;

// Book with relations
export type BookWithRelations = Book & {
  reviews?: ReviewWithUser[];
  shelfItems?: ShelfItem[];
  readingProgress?: ReadingProgress[];
  _count?: {
    reviews: number;
    shelfItems: number;
  };
  averageRating?: number;
};

// Shelf with books
export type ShelfWithBooks = Shelf & {
  shelfItems: (ShelfItem & {
    book: Book;
  })[];
  _count?: {
    shelfItems: number;
  };
};

// Shelf with its owner's public fields, for public shelf pages
export type ShelfWithOwner = ShelfWithBooks & {
  user: PublicUser;
};

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

export interface OpenLibraryWorkDetails {
  title: string;
  description?: string | { value: string };
  covers?: number[];
  subjects?: string[];
  authors?: { author: { key: string } }[];
}

// API Response types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

// Activity feed types
export type ActivityType = "shelf_add" | "review" | "progress" | "follow";

export interface Activity {
  id: string;
  type: ActivityType;
  userId: string;
  user: Pick<User, "id" | "name" | "avatarUrl">;
  bookId?: string;
  book?: Book;
  shelfId?: string;
  shelf?: Shelf;
  review?: Review;
  progress?: ReadingProgress;
  targetUserId?: string;
  targetUser?: Pick<User, "id" | "name" | "avatarUrl">;
  createdAt: Date;
}

// Form types
export interface BookFormData {
  title: string;
  author: string;
  isbn?: string;
  description?: string;
  coverUrl?: string;
  pageCount?: number;
  publishedDate?: string;
  genres?: string[];
}

export interface ReviewFormData {
  rating: number;
  content?: string;
}

// Search types
export interface SearchFilters {
  query: string;
  source: "local" | "openlibrary" | "all";
  genre?: string;
}
