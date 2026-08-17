"use client";

import { useState } from "react";
import StarRating from "@/components/ui/StarRating";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

interface ReviewFormProps {
  existingReview?: {
    rating: number;
    content: string | null;
  };
  onSubmit: (rating: number, content: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export default function ReviewForm({
  existingReview,
  onSubmit,
  onDelete,
}: ReviewFormProps) {
  const [rating, setRating] = useState(existingReview?.rating || 0);
  const [content, setContent] = useState(existingReview?.content || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) return;

    setIsSubmitting(true);
    try {
      await onSubmit(rating, content);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;

    setIsDeleting(true);
    try {
      await onDelete();
      setRating(0);
      setContent("");
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Your Rating
        </label>
        <StarRating
          rating={rating}
          size="lg"
          interactive
          onChange={setRating}
        />
      </div>

      <Textarea
        label="Your Review (optional)"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Share your thoughts about this book..."
        rows={4}
      />

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={rating === 0}
          isLoading={isSubmitting}
        >
          {existingReview ? "Update Review" : "Submit Review"}
        </Button>
        {existingReview && onDelete && (
          <Button
            type="button"
            variant="danger"
            onClick={() => setShowDeleteConfirm(true)}
            isLoading={isDeleting}
          >
            Delete
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete your review?"
        message="Your rating and review text will be removed from this book."
        confirmLabel="Delete review"
        destructive
        busy={isDeleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </form>
  );
}
