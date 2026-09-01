"use client";

import { useState } from "react";
import Image from "next/image";
import { coverUrl } from "@/lib/covers";

/**
 * A book cover, with a fallback for the common case of not having one.
 *
 * Every cover in the product is hotlinked from Open Library, and two things go
 * wrong often enough to be the normal case rather than the exception:
 *
 *   1. the work has no `cover_id` at all, and
 *   2. it has one and the image does not load.
 *
 * Only the first was handled. The second left the container's background
 * showing — a flat empty rectangle, four of six in "More by this author" on the
 * work page — because a failed `next/image` renders nothing and the box beneath
 * it was `bg-gray-800`. In dark mode that reads as a deliberate blank tile.
 *
 * The fallback is typeset rather than an icon: the title on book cloth says
 * which book it is, which a generic glyph repeated six times does not. The cloth
 * colour is keyed off `olKey` so a work always gets the same one, and the five
 * options are muted enough to sit behind text in either theme.
 *
 * A client component, because detecting case 2 needs `onError`. The wrapper box
 * is the caller's: pass `className` that establishes a size.
 */

/** Muted book-cloth colours. Dark in both themes — cloth, not a surface. */
const CLOTH = ["#2b2622", "#232a2b", "#33302a", "#2f2a33", "#23282f"] as const;

/** Stable per work, so a cover does not change colour between renders. */
function clothFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return CLOTH[hash % CLOTH.length];
}

type Size = "xs" | "sm" | "md" | "lg";

/** Below `sm` the title is illegible, so the cloth stands alone. */
const TITLE_CLASS: Record<Size, string | null> = {
  xs: null,
  sm: "text-[10px] leading-tight",
  md: "text-[11px] leading-tight",
  lg: "text-[13px] leading-snug",
};

interface CoverImageProps {
  title: string;
  coverId?: number | null;
  /** Keys the fallback colour. Falls back to the title when absent. */
  olKey?: string;
  /** Must establish the box, e.g. `aspect-[2/3] w-full` or `h-24 w-16`. */
  className?: string;
  /** `next/image` sizes hint. */
  sizes?: string;
  size?: Size;
  priority?: boolean;
}

export default function CoverImage({
  title,
  coverId,
  olKey,
  className = "",
  sizes = "160px",
  size = "md",
  priority = false,
}: CoverImageProps) {
  const [failed, setFailed] = useState(false);

  const src = coverUrl(coverId, size === "lg" ? "L" : "M");
  const showFallback = !src || failed;
  const titleClass = TITLE_CLASS[size];

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={showFallback ? { backgroundColor: clothFor(olKey ?? title) } : undefined}
    >
      {showFallback ? (
        <div className="absolute inset-0 flex flex-col justify-end p-2">
          {size === "lg" && (
            <span className="mb-1 text-[9px] uppercase tracking-[0.12em] text-[#e8e2d9]/55">
              No cover
            </span>
          )}
          {titleClass && (
            <span
              className={`line-clamp-4 font-medium text-[#e8e2d9] ${titleClass}`}
            >
              {title}
            </span>
          )}
        </div>
      ) : (
        <Image
          src={src}
          alt=""
          fill
          sizes={sizes}
          priority={priority}
          // The whole point: a 404 from Open Library becomes the fallback
          // rather than an empty box.
          onError={() => setFailed(true)}
          className="object-cover"
        />
      )}
    </div>
  );
}
