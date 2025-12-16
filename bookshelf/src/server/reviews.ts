import prisma from "@/lib/prisma";

export async function getBookReviews(bookId: string) {
  return prisma.review.findMany({
    where: { bookId },
    include: {
      user: {
        select: { id: true, name: true, avatarUrl: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getUserReviews(userId: string) {
  return prisma.review.findMany({
    where: { userId },
    include: {
      book: true,
      user: {
        select: { id: true, name: true, avatarUrl: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

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
    throw new Error("Rating must be between 1 and 5");
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
  });

  if (!review || review.userId !== userId) {
    throw new Error("Review not found");
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
