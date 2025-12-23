import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import Avatar from "@/components/ui/Avatar";
import StarRating from "@/components/ui/StarRating";

interface ReviewCardProps {
  review: {
    id: string;
    rating: number;
    content: string | null;
    createdAt: Date | string;
    user: {
      id: string;
      name: string;
      avatarUrl: string | null;
    };
    book?: {
      id: string;
      title: string;
      coverUrl: string | null;
    };
  };
  showBook?: boolean;
}

export default function ReviewCard({ review, showBook = false }: ReviewCardProps) {
  return (
    <div className="bg-[var(--card-bg)] rounded-lg border border-[var(--card-border)] p-4">
      <div className="flex items-start gap-3">
        <Link href={`/user/${review.user.id}`}>
          <Avatar
            src={review.user.avatarUrl}
            name={review.user.name}
            size="md"
          />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/user/${review.user.id}`}
              className="font-medium text-[var(--foreground)] hover:text-[#7047EB]"
            >
              {review.user.name}
            </Link>
            {showBook && review.book && (
              <>
                <span className="text-[var(--foreground-secondary)]">reviewed</span>
                <Link
                  href={`/book/${review.book.id}`}
                  className="font-medium text-[var(--foreground)] hover:text-[#7047EB]"
                >
                  {review.book.title}
                </Link>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <StarRating rating={review.rating} size="sm" />
            <span className="text-xs text-[var(--foreground-secondary)]">
              {formatDistanceToNow(new Date(review.createdAt), {
                addSuffix: true,
              })}
            </span>
          </div>
          {review.content && (
            <p className="mt-2 text-[var(--foreground-secondary)] text-sm whitespace-pre-wrap">
              {review.content}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
