import { notFound } from "next/navigation";
import Link from "next/link";
import { getUserProfile, isFollowing } from "@/server/users";
import { getCurrentUser } from "@/lib/session";
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
  const [user, currentUser] = await Promise.all([
    getUserProfile(userId),
    getCurrentUser(),
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
          <h1 className="text-2xl font-bold text-gray-900">{user.name}</h1>
          {user.bio && (
            <p className="text-gray-600 mt-2">{user.bio}</p>
          )}

          {/* Stats */}
          <div className="flex items-center justify-center sm:justify-start gap-6 mt-4 text-sm">
            <div className="flex items-center gap-1">
              <BookOpen className="h-4 w-4 text-gray-400" />
              <span className="font-medium">{booksRead}</span>
              <span className="text-gray-500">books read</span>
            </div>
            <div className="flex items-center gap-1">
              <Star className="h-4 w-4 text-gray-400" />
              <span className="font-medium">{user._count?.reviews || 0}</span>
              <span className="text-gray-500">reviews</span>
            </div>
            <div className="flex items-center gap-1">
              <Users className="h-4 w-4 text-gray-400" />
              <span className="font-medium">{user._count?.followers || 0}</span>
              <span className="text-gray-500">followers</span>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-4">
            {isOwnProfile ? (
              <Link
                href="/settings"
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
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
        <h2 className="text-xl font-bold text-gray-900 mb-4">Bookshelves</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {user.shelves.map((shelf) => (
            <Card key={shelf.id}>
              <CardContent>
                <h3 className="font-medium text-gray-900">{shelf.name}</h3>
                <p className="text-sm text-gray-500">
                  {shelf._count?.shelfItems || 0} books
                </p>
                {shelf.shelfItems.length > 0 && (
                  <div className="flex -space-x-2 mt-3">
                    {shelf.shelfItems.slice(0, 4).map((item) => (
                      <div
                        key={item.id}
                        className="w-10 h-14 rounded border-2 border-white overflow-hidden"
                        style={{
                          backgroundImage: item.book.coverUrl
                            ? `url(${item.book.coverUrl})`
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
      {user.reviews.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            Recent Reviews
          </h2>
          <div className="space-y-4">
            {user.reviews.map((review) => (
              <ReviewCard
                key={review.id}
                review={{
                  ...review,
                  user: {
                    id: user.id,
                    name: user.name,
                    avatarUrl: user.avatarUrl,
                  },
                }}
                showBook
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
