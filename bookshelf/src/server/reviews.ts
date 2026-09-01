import prisma from "@/lib/prisma";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/http/errors";
import { getWorksByKeys, workExists, type WorkSummary } from "./catalog";

/**
 * Ratings and reviews attach to the work. A rating of Dune is a rating of
 * Dune, whichever printing was read — precisely what the old book-per-edition
 * model could not express, and why its ratings were split across duplicates.
 */

export interface ReviewWithWork {
  id: string;
  rating: number;
  content: string | null;
  createdAt: Date;
  workKey: string;
  /** Null when the current ingest no longer carries this work. */
  work: WorkSummary | null;
  user: { id: string; name: string; avatarUrl: string | null };
}

const withUser = {
  user: { select: { id: true, name: true, avatarUrl: true } },
} as const;

export async function getWorkReviews(workKey: string, limit = 20) {
  return prisma.review.findMany({
    where: { workKey },
    include: withUser,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getUserReviewForWork(userId: string, workKey: string) {
  return prisma.review.findUnique({
    where: { userId_workKey: { userId, workKey } },
  });
}

export async function createOrUpdateReview(
  userId: string,
  workKey: string,
  rating: number,
  content?: string | null
) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ValidationError("Rating must be a whole number between 1 and 5");
  }

  // No foreign key protects this, so the check is explicit.
  if (!(await workExists(workKey))) {
    throw new NotFoundError("That book is not in the catalog");
  }

  return prisma.review.upsert({
    where: { userId_workKey: { userId, workKey } },
    create: { userId, workKey, rating, content },
    update: { rating, content },
    include: withUser,
  });
}

export async function deleteReview(reviewId: string, userId: string) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { userId: true },
  });

  if (!review) {
    throw new NotFoundError("Review not found");
  }

  if (review.userId !== userId) {
    throw new AuthorizationError("You can only delete your own review");
  }

  return prisma.review.delete({ where: { id: reviewId } });
}

async function hydrate(
  reviews: Array<{
    id: string;
    rating: number;
    content: string | null;
    createdAt: Date;
    workKey: string;
    user: { id: string; name: string; avatarUrl: string | null };
  }>
): Promise<ReviewWithWork[]> {
  const works = await getWorksByKeys(reviews.map((r) => r.workKey));
  return reviews.map((review) => ({
    ...review,
    work: works.get(review.workKey) ?? null,
  }));
}

/** Recent reviews across the site, hydrated with catalog data. */
export async function getRecentReviews(limit = 10): Promise<ReviewWithWork[]> {
  return hydrate(
    await prisma.review.findMany({
      include: withUser,
      orderBy: { createdAt: "desc" },
      take: limit,
    })
  );
}

export async function getUserReviews(
  userId: string,
  limit = 20
): Promise<ReviewWithWork[]> {
  return hydrate(
    await prisma.review.findMany({
      where: { userId },
      include: withUser,
      orderBy: { createdAt: "desc" },
      take: limit,
    })
  );
}

/**
 * Community rating for a work, aggregated in the database rather than by
 * loading every review and averaging in JavaScript.
 */
export async function getAverageRating(workKey: string) {
  const result = await prisma.review.aggregate({
    where: { workKey },
    _avg: { rating: true },
    _count: { rating: true },
  });

  return {
    average: Math.round((result._avg.rating ?? 0) * 10) / 10,
    count: result._count.rating,
  };
}

/** Ratings for many works at once, for grids and shelves. */
export async function getAverageRatings(
  workKeys: string[]
): Promise<Map<string, { average: number; count: number }>> {
  const unique = [...new Set(workKeys)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const rows = await prisma.review.groupBy({
    by: ["workKey"],
    where: { workKey: { in: unique } },
    _avg: { rating: true },
    _count: { rating: true },
  });

  return new Map(
    rows.map((row) => [
      row.workKey,
      {
        average: Math.round((row._avg.rating ?? 0) * 10) / 10,
        count: row._count.rating,
      },
    ])
  );
}
