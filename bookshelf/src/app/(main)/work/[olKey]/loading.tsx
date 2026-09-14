import { SkeletonBlock, LoadingRegion } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <LoadingRegion label="Loading this book" />
      <div className="flex flex-col gap-8 sm:flex-row">
        <SkeletonBlock className="aspect-[2/3] w-full max-w-[220px] shrink-0" />
        <div className="flex-1 space-y-3">
          <SkeletonBlock className="h-8 w-3/4" />
          <SkeletonBlock className="h-5 w-1/2" />
          <SkeletonBlock className="h-5 w-40" />
          <SkeletonBlock className="mt-6 h-11 w-44" />
          <SkeletonBlock className="h-4 w-full" />
          <SkeletonBlock className="h-4 w-5/6" />
        </div>
      </div>
    </div>
  );
}
