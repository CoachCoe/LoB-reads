import { notFound } from "next/navigation";
import Link from "next/link";
import { getUserProfile, isFollowing } from "@/server/users";
import { getUserReviews } from "@/server/reviews";
import { coverUrl } from "@/lib/covers";
import { getCurrentUser } from "@/lib/auth/session";
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

  const readShelf = user.shelves.find((s) => s.name === "Read");
  const booksRead = readShelf?._count?.shelfItems || 0;

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
          {user.shelves.map((shelf) => (
            <Card key={shelf.id}>
              <CardContent>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">{shelf.name}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {shelf._count?.shelfItems || 0} books
                </p>
                {shelf.shelfItems.length > 0 && (
                  <div className="flex -space-x-2 mt-3">
                    {shelf.shelfItems.slice(0, 4).map((item) => (
                      <div
                        key={item.id}
                        className="w-10 h-14 rounded border-2 border-white overflow-hidden"
                        style={{
                          backgroundImage: coverUrl(item.work?.coverId)
                            ? `url(${coverUrl(item.work?.coverId)})`
                            : undefined,
                          backgroundSize: "cover",
                          backgroundColor: "#f3f4f6",
                        }}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
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
