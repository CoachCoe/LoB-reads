import { SkeletonBlock, LoadingRegion } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="px-4 py-6">
      <LoadingRegion label="Loading the map" />
      <SkeletonBlock className="h-9 w-40" />
      <SkeletonBlock className="mt-2 h-5 w-72" />
      <div className="mt-4 flex flex-wrap gap-2">
        <SkeletonBlock className="h-9 w-36 rounded-full" />
        <SkeletonBlock className="h-9 w-36 rounded-full" />
        <SkeletonBlock className="h-9 w-40 rounded-full" />
      </div>
      <SkeletonBlock className="mt-4 h-[60vh] w-full" />
    </div>
  );
}
