import { SkeletonBlock, SkeletonWorkGrid, LoadingRegion } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <LoadingRegion label="Loading your library" />
      <SkeletonBlock className="h-9 w-48" />
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <SkeletonBlock className="h-24" />
        <SkeletonBlock className="h-24" />
        <SkeletonBlock className="h-24" />
      </div>
      <SkeletonBlock className="mt-10 h-6 w-40" />
      <div className="mt-4">
        <SkeletonWorkGrid count={6} />
      </div>
    </div>
  );
}
