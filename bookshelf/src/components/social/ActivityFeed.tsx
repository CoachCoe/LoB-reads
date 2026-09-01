import Link from "next/link";
import { BookOpen, Star, BookMarked, CheckCircle2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import Avatar from "@/components/ui/Avatar";
import StarRating from "@/components/ui/StarRating";
import CoverImage from "@/components/catalog/CoverImage";
import type { FeedItem } from "@/server/users";

/**
 * What the people you follow have been doing.
 *
 * Each item names a work by key, hydrated from the catalog upstream. A work
 * that has since left the catalog slice still renders — losing someone's
 * activity because an ingest narrowed is worse than a placeholder.
 */
export default function ActivityFeed({ items }: { items: FeedItem[] }) {
  if (items.length === 0) {
    return (
      <div className="py-12 text-center">
        <BookOpen
          className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600"
          aria-hidden="true"
        />
        <p className="text-gray-600 dark:text-gray-400">Nothing here yet.</p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-500">
          Follow a few readers and their shelves, ratings and finished books
          will show up here.
        </p>
        <Link
          href="/search"
          className="mt-4 inline-block rounded-lg bg-[#D4A017] px-5 py-2 text-sm font-medium text-[var(--color-primary-contrast)] hover:bg-[#B8860B]"
        >
          Find books
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.id}>
          <FeedRow item={item} />
        </li>
      ))}
    </ul>
  );
}

const ICONS = {
  shelf_add: BookMarked,
  review: Star,
  finished: CheckCircle2,
} as const;

function FeedRow({ item }: { item: FeedItem }) {
  const Icon = ICONS[item.type];
  const title = item.work?.title ?? "a book no longer in the catalog";

  return (
    <article className="flex gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <Avatar src={item.user.avatarUrl} name={item.user.name} size="sm" />

      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          <Link
            href={`/user/${item.user.id}`}
            className="font-medium text-gray-900 hover:underline dark:text-gray-100"
          >
            {item.user.name}
          </Link>{" "}
          <Icon
            className="inline h-3.5 w-3.5 align-[-2px] text-gray-400"
            aria-hidden="true"
          />{" "}
          {item.type === "shelf_add" && (
            <>
              added{" "}
              <WorkLink workKey={item.workKey} title={title} /> to{" "}
              <span className="text-gray-600 dark:text-gray-400">
                {item.shelfName}
              </span>
            </>
          )}
          {item.type === "review" && (
            <>
              rated <WorkLink workKey={item.workKey} title={title} />
            </>
          )}
          {item.type === "finished" && (
            <>
              finished <WorkLink workKey={item.workKey} title={title} />
            </>
          )}
        </p>

        {item.type === "review" && item.rating !== undefined && (
          <div className="mt-1">
            <StarRating rating={item.rating} size="sm" />
          </div>
        )}

        {item.content && (
          <p className="mt-1 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">
            {item.content}
          </p>
        )}

        <time
          dateTime={item.createdAt.toISOString()}
          className="mt-1 block text-xs text-gray-400 dark:text-gray-500"
        >
          {formatDistanceToNow(item.createdAt, { addSuffix: true })}
        </time>
      </div>

      {item.work && (
        <Link href={`/work/${item.workKey}`} className="shrink-0">
          <CoverImage
            title={item.work.title}
            olKey={item.workKey}
            coverId={item.work.coverId}
            size="xs"
            sizes="40px"
            className="h-[60px] w-10 rounded"
          />
        </Link>
      )}
    </article>
  );
}

function WorkLink({ workKey, title }: { workKey: string; title: string }) {
  return (
    <Link
      href={`/work/${workKey}`}
      className="font-medium text-[#0B6157] hover:underline dark:text-[#52B7A6]"
    >
      {title}
    </Link>
  );
}
