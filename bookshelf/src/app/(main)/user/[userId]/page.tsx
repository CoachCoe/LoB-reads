import { notFound } from "next/navigation";
import Link from "next/link";
import { getUserProfile, isFollowing } from "@/server/users";
import { getUserReviews } from "@/server/reviews";
import CoverImage from "@/components/catalog/CoverImage";
import { getCurrentUser } from "@/lib/auth/session";
import { getReadingStats } from "@/server/progress";
import Avatar from "@/components/ui/Avatar";
import Card, { CardContent } from "@/components/ui/Card";
import ReviewCard from "@/components/reviews/ReviewCard";
import FollowButton from "./FollowButton";
import { BookOpen, Users, Star } from "lucide-react";

interface Props {
  params: Promise<{ userId: string }>;
}

export default async function UserProfilePage({ params }: Props) {
  const { userId } = await params;
  const [user, currentUser, reviews] = await Promise.all([
    getUserProfile(userId),
    getCurrentUser(),
    getUserReviews(userId, 5),
  ]);

  if (!user) {
    notFound();
  }

  const isOwnProfile = currentUser?.id === userId;
  const following = currentUser && !isOwnProfile
    ? await isFollowing(currentUser.id, userId)
    : false;

  // Finished reading sessions, which is what /my-books and /wrapped both count.
  // This page used to count the "Read" shelf instead, so the same account showed
  // two different figures on two pages — and the shelf can be filled by the
  // Goodreads importer or by AddToShelfButton without a session ever existing.
  const { booksRead } = await getReadingStats(userId);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Profile header */}
      <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 mb-8">
        <Avatar
          src={user.avatarUrl}
          name={user.name}
          size="xl"
        />
        <div className="flex-1 text-center sm:text-left">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{user.name}</h1>
          {user.bio && (
            <p className="text-gray-600 dark:text-gray-400 mt-2">{user.bio}</p>
          )}

          {/* Stats */}
          <div className="flex items-center justify-center sm:justify-start gap-6 mt-4 text-sm">
            <div className="flex items-center gap-1">
              <BookOpen className="h-4 w-4 text-gray-400 dark:text-gray-500" />
              <span className="font-medium">{booksRead}</span>
              <span className="text-gray-500 dark:text-gray-400">books read</span>
            </div>
            <div className="flex items-center gap-1">
              <Star className="h-4 w-4 text-gray-400 dark:text-gray-500" />
              <span className="font-medium">{user._count?.reviews || 0}</span>
              <span className="text-gray-500 dark:text-gray-400">reviews</span>
            </div>
            <div className="flex items-center gap-1">
              <Users className="h-4 w-4 text-gray-400 dark:text-gray-500" />
              <span className="font-medium">{user._count?.followers || 0}</span>
              <span className="text-gray-500 dark:text-gray-400">followers</span>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-4">
            {isOwnProfile ? (
              <Link
                href="/settings"
                className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Edit Profile
              </Link>
            ) : currentUser ? (
              <FollowButton userId={userId} initialFollowing={following} />
            ) : null}
          </div>
        </div>
      </div>

      {/* Shelves preview */}
      <section className="mb-8">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">Bookshelves</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/*
            A public shelf page exists, renders without a session, and
            getShelfById deliberately has no owner check — but nothing linked to
            it except the owner's own /my-books. PRD section 2 promises a
            browser "must never hit a login wall to look at a book or a public
            shelf"; there was no wall and no door either.
          */}
          {user.shelves.map((shelf) => (
            <Link key={shelf.id} href={`/shelf/${shelf.id}`} className="block">
              <Card className="h-full transition-colors hover:border-[#D4A017]">
              <CardContent>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">{shelf.name}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {shelf._count?.shelfItems || 0} books
                </p>
                {shelf.shelfItems.length > 0 && (
                  <div className="flex -space-x-2 mt-3">
                    {shelf.shelfItems.slice(0, 4).map((item) => (
                      <CoverImage
                        key={item.id}
                        title={item.work?.title ?? ""}
                        olKey={item.workKey}
                        coverId={item.work?.coverId}
                        size="xs"
                        sizes="40px"
                        className="h-14 w-10 rounded border-2 border-[var(--card-bg)]"
                      />
                    ))}
                  </div>
                )}
              </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Recent reviews */}
      {reviews.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            Recent Reviews
          </h2>
          <div className="space-y-4">
            {reviews.map((review) => (
              <ReviewCard
                key={review.id}
                review={review}
                showWork
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
