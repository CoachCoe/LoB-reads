import WorkCard from "./WorkCard";
import type { WorkSummary } from "@/server/catalog";

interface WorkGridProps {
  items: { id: string; workKey: string; work: WorkSummary | null }[];
  emptyMessage?: string;
}

/**
 * A grid of works from a shelf.
 *
 * An item whose work is missing from the catalog still renders, with its key
 * shown. Dropping it would make a shelf quietly lose books whenever an ingest
 * narrowed the slice.
 */
export default function WorkGrid({ items, emptyMessage }: WorkGridProps) {
  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-gray-500 dark:text-gray-400">
        {emptyMessage ?? "Nothing here yet"}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {items.map((item) =>
        item.work ? (
          <WorkCard key={item.id} {...item.work} />
        ) : (
          <div
            key={item.id}
            className="flex flex-col gap-2 rounded-lg p-2 opacity-60"
          >
            <div className="aspect-[2/3] w-full rounded bg-gray-100 dark:bg-gray-800" />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Not in the current catalog
            </p>
            <p className="font-mono text-[10px] text-gray-400 dark:text-gray-500">{item.workKey}</p>
          </div>
        )
      )}
    </div>
  );
}
