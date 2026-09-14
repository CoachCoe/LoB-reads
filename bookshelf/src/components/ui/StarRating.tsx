"use client";

import { Star } from "lucide-react";
import { useRef, useState } from "react";

interface StarRatingProps {
  rating: number;
  maxRating?: number;
  size?: "sm" | "md" | "lg";
  interactive?: boolean;
  onChange?: (rating: number) => void;
  /** Names what is being rated, for assistive technology. */
  label?: string;
}

const SIZES = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

/**
 * The product's core input, and it had no accessible name of any kind.
 *
 * UX-26: five unlabelled `<button>`s with no role, no `aria-checked` and no
 * keyboard model, so a screen reader announced "button, button, button, button,
 * button" and there was no way to hear the current rating or set one without a
 * mouse. `focus:outline-none` also removed the only visible focus marker.
 *
 * Two different controls share this component and they need different
 * semantics, which is why the branch is at the top rather than per-star:
 *
 *  - Read-only, the common case, is not interactive at all. It was rendered as
 *    five disabled buttons, which is five tab-stop-shaped things announcing
 *    nothing. It is one image with one label: "Rated 4 out of 5".
 *  - Interactive is a radio group. Arrow keys move and select, Home and End go
 *    to the ends, and a roving tabindex means the group is one tab stop rather
 *    than five — the pattern the WAI-ARIA radiogroup guidance describes.
 *
 * Clearing a rating by clicking the current star is deliberately NOT added
 * here: the review schema requires 1-5, so "no rating" means deleting the
 * review, which is a different action with its own control. Recorded as an open
 * question rather than invented.
 */
export default function StarRating({
  rating,
  maxRating = 5,
  size = "md",
  interactive = false,
  onChange,
  label,
}: StarRatingProps) {
  const [hoverRating, setHoverRating] = useState(0);
  const groupRef = useRef<HTMLDivElement>(null);

  const stars = Array.from({ length: maxRating }, (_, i) => i + 1);

  const starClass = (filled: boolean) =>
    `${SIZES[size]} ${
      filled
        ? "fill-[var(--color-primary)] text-[var(--color-primary)]"
        : // An empty star is a placeholder, so it should be quiet: gray-200 is
          // 1.24:1 on white, which is the design intent. Unpaired, though, the
          // same class is 14.88:1 on the dark card — brighter than the gold
          // fill, so a 2-star rating read as five. gray-700 is 1.79:1, matching
          // the light weight with a little more presence, since in the
          // interactive form these are the click targets.
          "fill-gray-200 text-gray-200 dark:fill-gray-700 dark:text-gray-700"
    } transition-colors`;

  if (!interactive) {
    return (
      <div
        className="flex items-center gap-0.5"
        role="img"
        aria-label={
          label
            ? `${label}: rated ${rating} out of ${maxRating}`
            : `Rated ${rating} out of ${maxRating}`
        }
      >
        {stars.map((index) => (
          <Star key={index} aria-hidden="true" className={starClass(index <= rating)} />
        ))}
      </div>
    );
  }

  const select = (value: number) => onChange?.(value);

  /** Move selection and focus together, the way a radio group does. */
  const moveTo = (value: number) => {
    const clamped = Math.min(maxRating, Math.max(1, value));
    select(clamped);
    groupRef.current
      ?.querySelectorAll<HTMLButtonElement>("[role='radio']")
      [clamped - 1]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        event.preventDefault();
        moveTo((rating || 0) + 1);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        event.preventDefault();
        moveTo((rating || maxRating + 1) - 1);
        break;
      case "Home":
        event.preventDefault();
        moveTo(1);
        break;
      case "End":
        event.preventDefault();
        moveTo(maxRating);
        break;
    }
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label ? `${label}: your rating` : "Your rating"}
      className="flex items-center gap-0.5"
      onKeyDown={onKeyDown}
      onMouseLeave={() => setHoverRating(0)}
    >
      {stars.map((index) => (
        <button
          key={index}
          type="button"
          role="radio"
          aria-checked={index === rating}
          aria-label={index === 1 ? "1 star" : `${index} stars`}
          // Roving tabindex: one tab stop for the group. With no rating yet the
          // first star is the entry point, which is where a reader expects to
          // land.
          tabIndex={index === (rating || 1) ? 0 : -1}
          className="cursor-pointer rounded transition-transform hover:scale-110"
          onClick={() => select(index)}
          onMouseEnter={() => setHoverRating(index)}
        >
          <Star aria-hidden="true" className={starClass(index <= (hoverRating || rating))} />
        </button>
      ))}
    </div>
  );
}
