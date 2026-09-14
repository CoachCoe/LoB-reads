import Link from "next/link";
import { MapPin } from "lucide-react";
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
        /* UX-1. The differentiator was the third clause of a subtitle, and
           nothing on this page linked /map at all — so a visitor learned this
           was a reading tracker, which they already have. PRD section 1 says
           the bet is that "where" is an under-served way into a library; the
           landing page now leads with it, and "Explore the map" is a first-class
           destination rather than a feature buried behind an account.

           Placement only. Making the map itself the home page is the larger
           move and it is a product decision (OQ-E), not an audit's. */
        <div className="mb-12 text-center">
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-[var(--foreground)] sm:text-5xl">
            Every book you&apos;ve read, and everywhere it took you.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-[var(--foreground-secondary)]">
            A reading tracker built around place. Bring your Goodreads library,
            then watch your reading fill in the map.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              href="/register"
              className="rounded-lg bg-[var(--color-primary)] px-6 py-2.5 font-medium text-[var(--color-primary-contrast)] hover:bg-[var(--color-primary-dark)]"
            >
              Get started
            </Link>
            <Link
              href="/map"
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-6 py-2.5 font-medium text-[var(--foreground)] hover:bg-[var(--border-light)]"
            >
              <MapPin className="h-4 w-4 text-[var(--color-primary)]" aria-hidden="true" />
              Explore the map
            </Link>
            <Link
              href="/search"
              className="rounded-lg border border-[var(--border)] px-6 py-2.5 font-medium text-[var(--foreground)] hover:bg-[var(--border-light)]"
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
            className="text-sm text-[var(--color-link)] hover:underline"
          >
            Browse all
          </Link>
        </div>
        {popular.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">
            {/* Reader-facing copy. This told a signed-out visitor on the
                landing page to "run npm run ingest"; an empty catalog is an
                operator problem and the readiness probe already reports it. */}
            No books to show yet — please check back shortly.
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
