import Link from "next/link";
import CoverImage from "@/components/catalog/CoverImage";

interface WorkCardProps {
  olKey: string;
  title: string;
  authorNames?: string | null;
  firstPublishYear?: number | null;
  editionCount?: number;
  coverId?: number | null;
}

/**
 * A work in a grid. Links to /work/[olKey] — the catalog identity — rather
 * than to a local book row, which may not exist for most of the catalog.
 */
export default function WorkCard({
  olKey,
  title,
  authorNames,
  firstPublishYear,
  editionCount,
  coverId,
}: WorkCardProps) {
  return (
    <Link
      href={`/work/${olKey}`}
      className="group flex flex-col gap-2 rounded-lg p-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
    >
      <CoverImage
        title={title}
        olKey={olKey}
        coverId={coverId}
        size="md"
        sizes="(max-width: 640px) 45vw, (max-width: 1024px) 22vw, 160px"
        className="aspect-[2/3] w-full rounded"
      />

      <div className="min-w-0">
        <h3 className="line-clamp-2 text-sm font-medium text-gray-900 dark:text-gray-100">
          {title}
        </h3>
        {authorNames && (
          <p className="line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
            {authorNames}
          </p>
        )}
        <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
          {firstPublishYear ?? "Year unknown"}
          {editionCount && editionCount > 1
            ? ` · ${editionCount} editions`
            : ""}
        </p>
      </div>
    </Link>
  );
}
