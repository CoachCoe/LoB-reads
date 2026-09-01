"use client";

import { useRouter } from "next/navigation";
import { useToast } from "@/components/providers/ToastProvider";
import ReviewForm from "./ReviewForm";

interface Props {
  workKey: string;
  /** The reader's own review, if they have written one. */
  existingReview: {
    id: string;
    rating: number;
    content: string | null;
  } | null;
}

/**
 * Connects ReviewForm to the API.
 *
 * ReviewForm is presentational — it takes `onSubmit` and `onDelete` and has no
 * idea where a review goes. Nothing supplied those handlers, so the form was
 * mounted nowhere and `/api/reviews` was called by no client code at all:
 * there was no way to rate or review a book in the UI, and the only ratings in
 * the database arrived through the Goodreads importer.
 *
 * The existing review is fetched on the server and passed down, so opening a
 * work page does not cost a round trip to discover the reader has not reviewed
 * it — which is the common case.
 */
export default function WorkReviewSection({ workKey, existingReview }: Props) {
  const router = useRouter();
  const { showToast } = useToast();

  // Errors are reported here rather than thrown. ReviewForm wraps onSubmit in
  // try/finally with no catch, so a rejection would stop its spinner and
  // otherwise vanish — the reader would see a form that had apparently done
  // nothing, with no way to tell a failure from a slow save.
  const handleSubmit = async (rating: number, content: string) => {
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workKey, rating, content: content || undefined }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        showToast(data.error ?? "Could not save your review", "error");
        return;
      }

      showToast(existingReview ? "Review updated" : "Review saved", "success");
      // The page shows the community average and the reader's own stars, and
      // this changes both.
      router.refresh();
    } catch {
      showToast("Could not reach the server. Try again.", "error");
    }
  };

  const handleDelete = async () => {
    if (!existingReview) return;

    try {
      const response = await fetch(`/api/reviews/${existingReview.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        showToast("Could not remove your review", "error");
        return;
      }

      showToast("Review removed", "success");
      router.refresh();
    } catch {
      showToast("Could not reach the server. Try again.", "error");
    }
  };

  return (
    <ReviewForm
      existingReview={
        existingReview
          ? { rating: existingReview.rating, content: existingReview.content }
          : undefined
      }
      onSubmit={handleSubmit}
      onDelete={existingReview ? handleDelete : undefined}
    />
  );
}
