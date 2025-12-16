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
    <div className="bg-white rounded-lg border border-gray-100 p-4">
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
              className="font-medium text-gray-900 hover:text-amber-600"
            >
              {review.user.name}
            </Link>
            {showBook && review.book && (
              <>
                <span className="text-gray-400">reviewed</span>
                <Link
                  href={`/book/${review.book.id}`}
                  className="font-medium text-gray-900 hover:text-amber-600"
                >
                  {review.book.title}
                </Link>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <StarRating rating={review.rating} size="sm" />
            <span className="text-xs text-gray-500">
              {formatDistanceToNow(new Date(review.createdAt), {
                addSuffix: true,
              })}
            </span>
          </div>
          {review.content && (
            <p className="mt-2 text-gray-600 text-sm whitespace-pre-wrap">
              {review.content}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
