import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import Avatar from "@/components/ui/Avatar";
import StarRating from "@/components/ui/StarRating";

interface ReviewCardProps {
  review: {
    id: string;
    rating: number;
    content: string | null;
    createdAt: Date;
    workKey: string;
    work: { title: string; authorNames: string | null; coverId: number | null } | null;
    user: { id: string; name: string; avatarUrl: string | null };
  };
  /** Show which book the review is of — off on a work page, on in a feed. */
  showWork?: boolean;
  onDelete?: () => void;
}

export default function ReviewCard({ review, showWork = false }: ReviewCardProps) {
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
              className="font-medium text-[var(--foreground)] hover:text-[#D4A017]"
            >
              {review.user.name}
            </Link>
            {/*
              The `review.work &&` guard used to sit here, which suppressed the
              whole element when the work was absent and made the fallback on the
              next line unreachable. ARCHITECTURE.md requires the opposite —
              "Read paths tolerate absence… render as 'not in the current
              catalog' rather than vanishing" — and absence is the NORMAL case
              here, since getWorksByKeys omits keys the current ingest dropped.
            */}
            {showWork && (
              <>
                <span className="text-[var(--foreground-secondary)]">reviewed</span>
                <Link
                  href={`/work/${review.workKey}`}
                  className="font-medium text-[var(--foreground)] hover:text-[#D4A017]"
                >
                  {review.work?.title ?? "a book no longer in the catalog"}
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
