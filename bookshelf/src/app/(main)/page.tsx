import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getPopularWorks } from "@/server/catalog";
import { getCurrentlyReading } from "@/server/progress";
import { getRecentReviews } from "@/server/reviews";
import WorkCard from "@/components/catalog/WorkCard";
import CurrentlyReadingCard from "@/components/catalog/CurrentlyReadingCard";
import ReviewCard from "@/components/reviews/ReviewCard";

export default async function HomePage() {
  const user = await getCurrentUser();

  const [popular, reading, reviews] = await Promise.all([
    getPopularWorks(12),
    user ? getCurrentlyReading(user.id) : Promise.resolve([]),
    getRecentReviews(6),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {user ? (
        <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-100">
          Welcome back, {user.name?.split(" ")[0] ?? "reader"}
        </h1>
      ) : (
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100">
            Life on Books
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-lg text-gray-600 dark:text-gray-400">
            Track what you read, keep your shelves, and map where the stories
            happen.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/register"
              className="rounded-lg bg-[#D4A017] px-6 py-2.5 font-medium text-white hover:bg-[#B8860B]"
            >
              Get started
            </Link>
            <Link
              href="/search"
              className="rounded-lg border border-gray-300 px-6 py-2.5 font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Browse books
            </Link>
          </div>
        </div>
      )}

      {reading.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-bold text-gray-900 dark:text-gray-100">
            Currently reading
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {reading.map((session) => (
              <CurrentlyReadingCard key={session.id} session={session} />
            ))}
          </div>
        </section>
      )}

      <section className="mb-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            Most published
          </h2>
          <Link
            href="/search"
            className="text-sm text-[#0B6157] hover:underline dark:text-[#52B7A6]"
          >
            Browse all
          </Link>
        </div>
        {popular.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">
            The catalog is empty — run <code>npm run ingest</code> to populate it.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {popular.map((work) => (
              <WorkCard key={work.olKey} {...work} />
            ))}
          </div>
        )}
      </section>

      {reviews.length > 0 && (
        <section>
          <h2 className="mb-3 text-xl font-bold text-gray-900 dark:text-gray-100">
            Recent reviews
          </h2>
          <div className="space-y-4">
            {reviews.map((review) => (
              <ReviewCard key={review.id} review={review} showWork />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
