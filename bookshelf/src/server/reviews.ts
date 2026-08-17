import prisma from "@/lib/prisma";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

export async function getUserReviewForBook(userId: string, bookId: string) {
  return prisma.review.findUnique({
    where: {
      userId_bookId: { userId, bookId },
    },
  });
}

export async function createOrUpdateReview(
  userId: string,
  bookId: string,
  rating: number,
  content?: string | null
) {
  if (rating < 1 || rating > 5) {
    throw new ValidationError("Rating must be between 1 and 5");
  }

  return prisma.review.upsert({
    where: {
      userId_bookId: { userId, bookId },
    },
    create: {
      userId,
      bookId,
      rating,
      content,
    },
    update: {
      rating,
      content,
    },
    include: {
      user: {
        select: { id: true, name: true, avatarUrl: true },
      },
    },
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

  return prisma.review.delete({
    where: { id: reviewId },
  });
}

export async function getRecentReviews(limit = 10) {
  return prisma.review.findMany({
    include: {
      user: {
        select: { id: true, name: true, avatarUrl: true },
      },
      book: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getAverageRating(bookId: string) {
  const result = await prisma.review.aggregate({
    where: { bookId },
    _avg: { rating: true },
    _count: { rating: true },
  });

  return {
    average: result._avg.rating || 0,
    count: result._count.rating,
  };
}
