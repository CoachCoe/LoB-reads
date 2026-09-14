import { SkeletonBlock, LoadingRegion } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <LoadingRegion label="Loading your feed" />
      <SkeletonBlock className="h-9 w-40" />
      <div className="mt-6 space-y-4">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex gap-4">
            <SkeletonBlock className="h-12 w-12 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-4 w-2/3" />
              <SkeletonBlock className="h-4 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
