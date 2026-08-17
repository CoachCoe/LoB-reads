import prisma from "@/lib/prisma";
import { ValidationError } from "@/lib/http/errors";
import { getWorksByKeys, type WorkSummary } from "./catalog";

/**
 * Fields that may be shown to anyone. Profiles and shelves are public, so this
 * is the boundary that keeps `email` and `passwordHash` out of responses —
 * previously the whole row was returned and the route stripped only the hash,
 * which meant every user's email address was readable via the API.
 */
const publicUserSelect = {
  id: true,
  name: true,
  avatarUrl: true,
  bio: true,
  createdAt: true,
} as const;

/** Every new account starts with these three; order is the display order. */
const DEFAULT_SHELVES = ["Want to Read", "Currently Reading", "Read"];

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email }, select: { id: true } });
}

/**
 * Creates the account and its default shelves in one transaction. Creating
 * them separately could leave an account that exists but has no shelves,
 * which nothing repairs and which blocks re-registering the address.
 */
export async function createUserWithDefaultShelves(data: {
  email: string;
  passwordHash: string;
  name: string;
  avatarUrl: string;
}) {
  return prisma.user.create({
    data: {
      ...data,
      shelves: {
        create: DEFAULT_SHELVES.map((name) => ({ name, isDefault: true })),
      },
    },
    select: { id: true, email: true, name: true },
  });
}

export async function getUserProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...publicUserSelect,
      shelves: {
        where: { isDefault: true },
        select: {
          id: true,
          name: true,
          isDefault: true,
          shelfItems: {
            select: { id: true, workKey: true },
            orderBy: { addedAt: "desc" },
            take: 5,
          },
          _count: { select: { shelfItems: true } },
        },
      },
      _count: { select: { followers: true, following: true, reviews: true } },
    },
  });

  if (!user) return null;

  // Hydrate the preview covers from the catalog in one lookup.
  const works = await getWorksByKeys(
    user.shelves.flatMap((s) => s.shelfItems.map((i) => i.workKey))
  );

  return {
    ...user,
    shelves: user.shelves.map((shelf) => ({
      ...shelf,
      shelfItems: shelf.shelfItems.map((item) => ({
        ...item,
        work: works.get(item.workKey) ?? null,
      })),
    })),
  };
}

/** Used to clean up the previous blob when an avatar is replaced. */
export async function getUserAvatarUrl(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  });
  return user?.avatarUrl ?? null;
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
    select: publicUserSelect,
  });
}

export async function followUser(followerId: string, followingId: string) {
  if (followerId === followingId) {
    throw new ValidationError("Cannot follow yourself");
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

export interface FeedItem {
  id: string;
  type: "shelf_add" | "review" | "finished";
  createdAt: Date;
  user: { id: string; name: string; avatarUrl: string | null };
  workKey: string;
  work: WorkSummary | null;
  shelfName?: string;
  rating?: number;
  content?: string | null;
}

export async function getFollowingCount(userId: string): Promise<number> {
  return prisma.follow.count({ where: { followerId: userId } });
}

export async function getActivityFeed(
  userId: string,
  limit = 20
): Promise<FeedItem[]> {
  const following = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { followingId: true },
  });

  const followingIds = following.map((f) => f.followingId);
  if (followingIds.length === 0) return [];

  const withUser = {
    user: { select: { id: true, name: true, avatarUrl: true } },
  } as const;

  const [shelfItems, reviews, finished] = await Promise.all([
    prisma.shelfItem.findMany({
      where: { userId: { in: followingIds }, shelf: { isDefault: true } },
      include: { shelf: { select: { name: true } }, ...withUser },
      orderBy: { addedAt: "desc" },
      take: limit,
    }),
    prisma.review.findMany({
      where: { userId: { in: followingIds } },
      include: withUser,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.readingSession.findMany({
      where: { userId: { in: followingIds }, finishedAt: { not: null } },
      include: withUser,
      orderBy: { finishedAt: "desc" },
      take: limit,
    }),
  ]);

  // One catalog lookup for all three sources.
  const works = await getWorksByKeys([
    ...shelfItems.map((i) => i.workKey),
    ...reviews.map((r) => r.workKey),
    ...finished.map((s) => s.workKey),
  ]);

  const items: FeedItem[] = [
    ...shelfItems.map((item) => ({
      id: `shelf-${item.id}`,
      type: "shelf_add" as const,
      createdAt: item.addedAt,
      user: item.user,
      workKey: item.workKey,
      work: works.get(item.workKey) ?? null,
      shelfName: item.shelf.name,
    })),
    ...reviews.map((review) => ({
      id: `review-${review.id}`,
      type: "review" as const,
      createdAt: review.createdAt,
      user: review.user,
      workKey: review.workKey,
      work: works.get(review.workKey) ?? null,
      rating: review.rating,
      content: review.content,
    })),
    ...finished.map((session) => ({
      id: `finished-${session.id}`,
      type: "finished" as const,
      createdAt: session.finishedAt!,
      user: session.user,
      workKey: session.workKey,
      work: works.get(session.workKey) ?? null,
    })),
  ];

  // Each source is limited independently, so the merge is approximate at the
  // tail — acceptable for a feed, and far cheaper than a UNION across three
  // tables plus a catalog join.
  return items
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}
