import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { BookOpen, Calendar, Layers } from "lucide-react";
import {
  getWorkByKey,
  getOtherWorksByAuthor,
  getSimilarWorks,
  getWorkRating,
  EDITIONS_PAGE_SIZE,
} from "@/server/catalog";
import { coverUrl } from "@/lib/covers";
import StarRating from "@/components/ui/StarRating";
import WorkCard from "@/components/catalog/WorkCard";
import EditionList from "./EditionList";
import WorkLocationsSection from "@/components/catalog/WorkLocationsSection";
import AddToShelfButton from "@/components/catalog/AddToShelfButton";
import ReadingProgressSection from "@/components/catalog/ReadingProgressSection";
import WorkReviewSection from "@/components/reviews/WorkReviewSection";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserReviewForWork } from "@/server/reviews";
import { enqueue } from "@/server/enrichment";

interface Props {
  params: Promise<{ olKey: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { olKey } = await params;
  const work = await getWorkByKey(olKey);
  if (!work) return { title: "Work not found" };

  const byline = work.authors.map((a) => a.name).join(", ");
  return {
    title: byline ? `${work.title} by ${byline}` : work.title,
    description: work.description?.slice(0, 160) ?? undefined,
  };
}

/**
 * Work detail, backed by the Open Library catalog.
 *
 * This is a *work* — the abstract book — not an edition. Editions are listed
 * separately below, which is the distinction the legacy `app.books` model
 * could not make: there, two printings were two unrelated rows.
 */
export default async function WorkPage({ params }: Props) {
  const { olKey } = await params;
  const work = await getWorkByKey(olKey);

  if (!work) {
    notFound();
  }

  const primaryAuthor = work.authors[0];
  const [alsoBy, alsoEnjoyed, rating, user] = await Promise.all([
    primaryAuthor
      ? getOtherWorksByAuthor(primaryAuthor.olKey, work.olKey, 6)
      : Promise.resolve([]),
    getSimilarWorks(work.olKey, 6),
    getWorkRating(work.olKey),
    getCurrentUser(),
  ]);

  // A missing description queues a backfill. This is a single INSERT with an
  // ON CONFLICT — no outbound request happens here, and none ever should: a
  // page render that calls a third party inherits that third party's latency
  // and downtime.
  //
  // Only for a signed-in reader, and never awaited. The page is public and
  // dynamically rendered per request, so as an awaited write on an anonymous
  // path it let anyone fill catalog.enrichment_queue by walking sequential
  // public Open Library keys. claimJobs orders by created_at, so a junk queue
  // drains AHEAD of genuinely popular works and defeats the prioritisation
  // backfill.ts and PRD R4 exist for — at a worker rate of five per second.
  if (!work.description && user?.id) {
    void enqueue({
      entityType: "work",
      entityKey: work.olKey,
      field: "description",
      source: "google_books",
    }).catch((error) => {
      // Best effort: a queue insert must not fail the page it decorates.
      console.error("Failed to queue description enrichment:", error);
    });
  }

  // Fetched on the server so opening a work page costs no round trip to
  // discover the reader has not reviewed it, which is the common case.
  const ownReview = user?.id
    ? await getUserReviewForWork(user.id, work.olKey)
    : null;

  // Progress needs a denominator. Editions disagree about page counts, so take
  // the first that states one from the editions already loaded rather than
  // spending a query on it. Null is fine — the component then tracks a page
  // number without a percentage, which is better than refusing to track.
  const pageCount =
    work.editions.find((edition) => edition.numberOfPages)?.numberOfPages ??
    null;

  const coverEdition = work.editions.find(
    (e) => e.olKey === work.coverEditionKey
  );
  const cover = coverUrl(
    coverEdition?.coverId ?? work.editions.find((e) => e.coverId)?.coverId,
    "L"
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-col gap-8 sm:flex-row">
        <div className="mx-auto w-40 shrink-0 sm:mx-0 sm:w-48">
          <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-100 shadow-sm dark:bg-gray-800">
            {cover ? (
              <Image
                src={cover}
                alt={`Cover of ${work.title}`}
                fill
                sizes="192px"
                className="object-cover"
                priority
              />
            ) : (
              <div className="flex h-full items-center justify-center text-gray-300 dark:text-gray-600">
                <BookOpen className="h-10 w-10" aria-hidden="true" />
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {work.title}
          </h1>
          {work.subtitle && (
            <p className="mt-1 text-lg text-gray-600 dark:text-gray-400">
              {work.subtitle}
            </p>
          )}

          {work.authors.length > 0 && (
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              by{" "}
              {work.authors.map((author, i) => (
                <span key={author.olKey}>
                  {i > 0 && ", "}
                  <Link
                    href={`/author/${encodeURIComponent(author.name)}`}
                    className="text-[#0B6157] hover:underline dark:text-[#52B7A6]"
                  >
                    {author.name}
                  </Link>
                </span>
              ))}
            </p>
          )}

          {rating && rating.count > 0 && (
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <StarRating rating={Math.round(rating.average)} size="sm" />
                <span className="text-sm tabular-nums text-gray-600 dark:text-gray-400">
                  {rating.average.toFixed(1)}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  ({rating.count.toLocaleString()}{" "}
                  {rating.count === 1 ? "rating" : "ratings"})
                </span>
              </div>
              {rating.seedCount > 0 && <CorpusAttribution />}
            </div>
          )}

          {user?.id && (
            <div className="mt-4">
              <AddToShelfButton workKey={work.olKey} />
            </div>
          )}

          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-500 dark:text-gray-400">
            {work.firstPublishYear && (
              <div className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" aria-hidden="true" />
                <dt className="sr-only">First published</dt>
                <dd>First published {work.firstPublishYear}</dd>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Layers className="h-4 w-4" aria-hidden="true" />
              <dt className="sr-only">Editions</dt>
              <dd>
                {work.editionCount} {work.editionCount === 1 ? "edition" : "editions"}
              </dd>
            </div>
          </dl>

          {work.description && (
            <div className="mt-5">
              <p className="max-w-prose whitespace-pre-line text-gray-700 dark:text-gray-300">
                {work.description}
              </p>
              {/* Cached third-party content is attributed, never presented as
                  ours. That is a licence condition, not a courtesy. */}
              {work.descriptionSource === "google_books" && (
                <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                  Description via Google Books
                </p>
              )}
            </div>
          )}

          {work.subjects.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {work.subjects.slice(0, 8).map((subject) => (
                <Link
                  key={subject}
                  href={`/search?subject=${encodeURIComponent(subject)}`}
                  className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  {subject}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/*
        Reading progress and the reader's own review.

        Both components existed, spoke the pre-M3 `bookId` contract, and were
        mounted nowhere — so a reader could search 6.9 million books and not
        rate one. Shelves and ratings could only arrive through the Goodreads
        importer.
      */}
      {user?.id && (
        <>
          <section className="mt-10">
            <h2 className="mb-3 text-xl font-bold text-gray-900 dark:text-gray-100">
              Your reading
            </h2>
            <ReadingProgressSection workKey={work.olKey} pageCount={pageCount} />
          </section>

          <section className="mt-10">
            <h2 className="mb-3 text-xl font-bold text-gray-900 dark:text-gray-100">
              {ownReview ? "Your review" : "Rate this book"}
            </h2>
            <WorkReviewSection
              workKey={work.olKey}
              existingReview={
                ownReview
                  ? {
                      id: ownReview.id,
                      rating: ownReview.rating,
                      content: ownReview.content,
                    }
                  : null
              }
            />
          </section>
        </>
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-xl font-bold text-gray-900 dark:text-gray-100">
          Editions
        </h2>
        <EditionList
          workKey={work.olKey}
          initialEditions={work.editions}
          totalCount={work.editionCount}
          pageSize={EDITIONS_PAGE_SIZE}
        />
      </section>

      {/*
        Reader-contributed places this book is set in or mentions.
        
        The component, its API route and its server layer all existed and
        nothing rendered them: BookLocationsSection was rewritten as
        WorkLocationsSection during the repoint from app.books to work_key, and
        the new work page was never wired to it. The feature had been built and
        was simply unreachable.
      */}
      <section className="mt-10">
        <WorkLocationsSection
          workKey={work.olKey}
          currentUserId={user?.id}
          canModerate={Boolean(user?.isModerator)}
        />
      </section>

      {alsoEnjoyed.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-xl font-bold text-gray-900 dark:text-gray-100">
            Readers also enjoyed
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {alsoEnjoyed.map((other) => (
              <WorkCard key={other.olKey} {...other} />
            ))}
          </div>
          {/* Same corpus as the rating, so the same credit is owed. Neighbours
              come from catalog.work_similarity, which has no per-row provenance
              column — the graph is wholly corpus-derived today, so this is
              unconditional rather than driven by a count. */}
          <CorpusAttribution />
        </section>
      )}

      {alsoBy.length > 0 && primaryAuthor && (
        <section className="mt-10">
          <h2 className="mb-3 text-xl font-bold text-gray-900 dark:text-gray-100">
            More by {primaryAuthor.name}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {alsoBy.map((other) => (
              <WorkCard key={other.olKey} {...other} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Where the numbers came from.
 *
 * Ratings and "readers also enjoyed" are computed from goodbooks-10k, which is
 * CC BY-SA. PRD.md section 5 claimed "nothing derived from it is served"; it was,
 * on every work page. The honest fix is to say so and credit it rather than
 * pretend otherwise (audit SPEC-1, decisions OQ-1 and OQ-2).
 *
 * Under the rating it is conditional on `seed_count`, so a work rated entirely
 * by readers here carries no borrowed credit.
 */
function CorpusAttribution() {
  return (
    <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
      Includes ratings from{" "}
      <a
        href="https://github.com/zygmuntz/goodbooks-10k"
        className="underline hover:text-gray-700 dark:hover:text-gray-300"
        rel="noopener noreferrer"
        target="_blank"
      >
        goodbooks-10k
      </a>
      , used under{" "}
      <a
        href="https://creativecommons.org/licenses/by-sa/4.0/"
        className="underline hover:text-gray-700 dark:hover:text-gray-300"
        rel="noopener noreferrer"
        target="_blank"
      >
        CC BY-SA 4.0
      </a>
      .
    </p>
  );
}
