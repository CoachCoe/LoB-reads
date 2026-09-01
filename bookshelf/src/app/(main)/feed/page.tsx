import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { getActivityFeed, getFollowingCount } from "@/server/users";
import ActivityFeed from "@/components/social/ActivityFeed";

export const metadata: Metadata = { title: "Your feed" };

export default async function FeedPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?callbackUrl=/feed");
  }

  const [items, following] = await Promise.all([
    getActivityFeed(user.id, 40),
    getFollowingCount(user.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          Your feed
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Following {following} {following === 1 ? "reader" : "readers"}
        </p>
      </div>

      {following === 0 && (
        <p className="mb-6 rounded-lg border border-gray-200 p-4 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
          You are not following anyone yet. Open a{" "}
          <Link
            href="/search"
            className="text-[#0B6157] hover:underline dark:text-[#52B7A6]"
          >
            reader&rsquo;s profile
          </Link>{" "}
          and follow them to see what they are reading.
        </p>
      )}

      <ActivityFeed items={items} />
    </div>
  );
}
