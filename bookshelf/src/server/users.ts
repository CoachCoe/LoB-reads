import prisma from "@/lib/prisma";
import { UserWithRelations } from "@/types";

export async function getUserById(userId: string): Promise<UserWithRelations | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      _count: {
        select: {
          followers: true,
          following: true,
          reviews: true,
        },
      },
    },
  });
}

export async function getUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
  });
}

export async function getUserProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      shelves: {
        where: { isDefault: true },
        include: {
          shelfItems: {
            include: { book: true },
            orderBy: { addedAt: "desc" },
            take: 5,
          },
          _count: { select: { shelfItems: true } },
        },
      },
      reviews: {
        include: { book: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      _count: {
        select: {
          followers: true,
          following: true,
          reviews: true,
        },
      },
    },
  });

  return user;
}

export async function updateUserProfile(
  userId: string,
  data: {
    name?: string;
    bio?: string | null;
    avatarUrl?: string | null;
  }
) {
  return prisma.user.update({
    where: { id: userId },
    data,
  });
}

export async function followUser(followerId: string, followingId: string) {
  if (followerId === followingId) {
    throw new Error("Cannot follow yourself");
  }

  return prisma.follow.create({
    data: {
      followerId,
      followingId,
    },
  });
}

export async function unfollowUser(followerId: string, followingId: string) {
  return prisma.follow.delete({
    where: {
      followerId_followingId: { followerId, followingId },
    },
  });
}

export async function isFollowing(followerId: string, followingId: string) {
  const follow = await prisma.follow.findUnique({
    where: {
      followerId_followingId: { followerId, followingId },
    },
  });
  return !!follow;
}

export async function getUserFollowers(userId: string) {
  return prisma.follow.findMany({
    where: { followingId: userId },
    include: {
      follower: {
        select: { id: true, name: true, avatarUrl: true, bio: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getUserFollowing(userId: string) {
  return prisma.follow.findMany({
    where: { followerId: userId },
    include: {
      following: {
        select: { id: true, name: true, avatarUrl: true, bio: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getActivityFeed(userId: string, limit = 20) {
  // Get users that the current user follows
  const following = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { followingId: true },
  });

  const followingIds = following.map((f) => f.followingId);

  if (followingIds.length === 0) {
    return [];
  }

  // Get recent activities from followed users
  const [shelfItems, reviews, progress] = await Promise.all([
    // Shelf additions
    prisma.shelfItem.findMany({
      where: {
        shelf: {
          userId: { in: followingIds },
          isDefault: true,
        },
      },
      include: {
        book: true,
        shelf: {
          include: {
            user: {
              select: { id: true, name: true, avatarUrl: true },
            },
          },
        },
      },
      orderBy: { addedAt: "desc" },
      take: limit,
    }),

    // Reviews
    prisma.review.findMany({
      where: { userId: { in: followingIds } },
      include: {
        book: true,
        user: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),

    // Reading progress updates
    prisma.readingProgress.findMany({
      where: { userId: { in: followingIds } },
      include: {
        book: true,
        user: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
  ]);

  // Combine and sort activities
  const activities = [
    ...shelfItems.map((item) => ({
      id: `shelf-${item.id}`,
      type: "shelf_add" as const,
      userId: item.shelf.userId,
      user: item.shelf.user,
      bookId: item.bookId,
      book: item.book,
      shelfId: item.shelfId,
      shelfName: item.shelf.name,
      createdAt: item.addedAt,
    })),
    ...reviews.map((review) => ({
      id: `review-${review.id}`,
      type: "review" as const,
      userId: review.userId,
      user: review.user,
      bookId: review.bookId,
      book: review.book,
      rating: review.rating,
      content: review.content,
      createdAt: review.createdAt,
    })),
    ...progress.map((p) => ({
      id: `progress-${p.id}`,
      type: "progress" as const,
      userId: p.userId,
      user: p.user,
      bookId: p.bookId,
      book: p.book,
      currentPage: p.currentPage,
      finishedAt: p.finishedAt,
      createdAt: p.updatedAt,
    })),
  ];

  // Sort by date and take limit
  return activities
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}
