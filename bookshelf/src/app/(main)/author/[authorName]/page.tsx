import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/session";
import { findAuthorKeyByName, getAuthorByKey } from "@/server/authors";
import WorkCard from "@/components/catalog/WorkCard";
import AuthorLocationsSection from "@/components/authors/AuthorLocationsSection";

interface Props {
  params: Promise<{ authorName: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { authorName } = await params;
  return { title: decodeURIComponent(authorName) };
}

/**
 * Author page, backed by the catalog.
 *
 * The URL still carries a display name rather than an Open Library key —
 * `/author/Frank%20Herbert` reads better and keeps existing links working —
 * so the name is resolved to a key here.
 */
export default async function AuthorPage({ params }: Props) {
  const { authorName } = await params;
  const name = decodeURIComponent(authorName);

  const [authorKey, user] = await Promise.all([
    findAuthorKeyByName(name),
    getCurrentUser(),
  ]);

  if (!authorKey) {
    notFound();
  }

  const author = await getAuthorByKey(authorKey);
  if (!author) {
    notFound();
  }

  const lifespan = [author.birthDate, author.deathDate]
    .filter(Boolean)
    .join(" – ");

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
        {author.name}
      </h1>
      {lifespan && (
        <p className="mt-1 text-gray-500 dark:text-gray-400">{lifespan}</p>
      )}
      {author.bio && (
        <p className="mt-4 max-w-prose text-gray-700 dark:text-gray-300">
          {author.bio}
        </p>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-bold text-gray-900 dark:text-gray-100">
          Books ({author.works.length})
        </h2>
        {author.works.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">
            No works recorded for this author.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {author.works.map((work) => (
              <WorkCard key={work.olKey} {...work} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <AuthorLocationsSection
          authorName={author.name}
          currentUserId={user?.id}
        />
      </section>
    </div>
  );
}
