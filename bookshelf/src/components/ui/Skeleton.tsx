/**
 * Placeholder blocks for a route's loading state.
 *
 * UX-5: there was no loading UI anywhere in the product. Every page under
 * `(main)` is an async server component that awaits Postgres before emitting a
 * byte — the work page awaits five queries, and a search can spend the fuzzy
 * arm's whole budget — so the reader sat on the PREVIOUS page with no signal,
 * then got a blank one. A `loading.tsx` lets Next stream a shell immediately.
 *
 * Deliberately built from `.animate-shimmer`, which was already in globals.css
 * with zero uses: it is exactly what it was written for.
 */
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-shimmer rounded-lg ${className}`}
      // Decorative. The page announces its own loading state through the
      // route transition; five hundred shimmering divs announcing themselves
      // would be worse than silence.
      aria-hidden="true"
    />
  );
}

/** A grid of book covers, the shape most pages here are waiting for. */
export function SkeletonWorkGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2">
          <SkeletonBlock className="aspect-[2/3] w-full" />
          <SkeletonBlock className="h-3 w-4/5" />
          <SkeletonBlock className="h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}

/**
 * The status region every loading route announces through.
 *
 * One polite live region with a single message, rather than the skeletons
 * themselves being announced.
 */
export function LoadingRegion({ label }: { label: string }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {label}
    </span>
  );
}
