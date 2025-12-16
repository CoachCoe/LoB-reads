"use client";

import { useRouter } from "next/navigation";
import ReviewForm from "@/components/reviews/ReviewForm";

interface BookReviewSectionProps {
  bookId: string;
  existingReview: {
    id: string;
    rating: number;
    content: string | null;
  } | null;
}

export default function BookReviewSection({
  bookId,
  existingReview,
}: BookReviewSectionProps) {
  const router = useRouter();

  const handleSubmit = async (rating: number, content: string) => {
    const response = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId, rating, content }),
    });

    if (response.ok) {
      router.refresh();
    }
  };

  const handleDelete = async () => {
    if (!existingReview) return;

    const response = await fetch(`/api/reviews/${existingReview.id}`, {
      method: "DELETE",
    });

    if (response.ok) {
      router.refresh();
    }
  };

  return (
    <ReviewForm
      bookId={bookId}
      existingReview={existingReview || undefined}
      onSubmit={handleSubmit}
      onDelete={existingReview ? handleDelete : undefined}
    />
  );
}
