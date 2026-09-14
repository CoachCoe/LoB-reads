import { SkeletonBlock, SkeletonWorkGrid, LoadingRegion } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <LoadingRegion label="Searching" />
      <SkeletonBlock className="h-9 w-56" />
      <SkeletonBlock className="mt-6 h-12 w-full" />
      <SkeletonBlock className="mt-4 h-4 w-40" />
      <div className="mt-5">
        <SkeletonWorkGrid count={12} />
      </div>
    </div>
  );
}
