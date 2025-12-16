"use client";

import { Star } from "lucide-react";
import { useState } from "react";

interface StarRatingProps {
  rating: number;
  maxRating?: number;
  size?: "sm" | "md" | "lg";
  interactive?: boolean;
  onChange?: (rating: number) => void;
}

export default function StarRating({
  rating,
  maxRating = 5,
  size = "md",
  interactive = false,
  onChange,
}: StarRatingProps) {
  const [hoverRating, setHoverRating] = useState(0);

  const sizes = {
    sm: "h-4 w-4",
    md: "h-5 w-5",
    lg: "h-6 w-6",
  };

  const handleClick = (index: number) => {
    if (interactive && onChange) {
      onChange(index);
    }
  };

  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: maxRating }, (_, i) => i + 1).map((index) => {
        const isFilled = interactive
          ? index <= (hoverRating || rating)
          : index <= rating;

        return (
          <button
            key={index}
            type="button"
            className={`${interactive ? "cursor-pointer" : "cursor-default"} focus:outline-none transition-transform ${interactive ? "hover:scale-110" : ""}`}
            onClick={() => handleClick(index)}
            onMouseEnter={() => interactive && setHoverRating(index)}
            onMouseLeave={() => interactive && setHoverRating(0)}
            disabled={!interactive}
          >
            <Star
              className={`${sizes[size]} ${
                isFilled
                  ? "fill-[#7047EB] text-[#7047EB]"
                  : "fill-gray-200 text-gray-200"
              } transition-colors`}
            />
          </button>
        );
      })}
    </div>
  );
}
