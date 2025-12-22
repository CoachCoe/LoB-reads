import Link from "next/link";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import Avatar from "@/components/ui/Avatar";
import StarRating from "@/components/ui/StarRating";
import { BookOpen, BookPlus, Star, Check } from "lucide-react";

interface Activity {
  id: string;
  type: "shelf_add" | "review" | "progress";
  userId: string;
  user: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  bookId?: string;
  book?: {
    id: string;
    title: string;
    author: string;
    coverUrl: string | null;
  };
  shelfName?: string;
  rating?: number;
  content?: string | null;
  currentPage?: number;
  finishedAt?: Date | string | null;
  createdAt: Date | string;
}

interface ActivityFeedProps {
  activities: Activity[];
}

export default function ActivityFeed({ activities }: ActivityFeedProps) {
  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--foreground-secondary)]">
        No activity yet
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {activities.map((activity) => (
        <ActivityItem key={activity.id} activity={activity} />
      ))}
    </div>
  );
}

function ActivityItem({ activity }: { activity: Activity }) {
  const getIcon = () => {
    switch (activity.type) {
      case "shelf_add":
        return <BookPlus className="h-4 w-4 text-[#7047EB]" />;
      case "review":
        return <Star className="h-4 w-4 text-[#7047EB]" />;
      case "progress":
        return activity.finishedAt ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <BookOpen className="h-4 w-4 text-blue-500" />
        );
    }
  };

  const getMessage = () => {
    switch (activity.type) {
      case "shelf_add":
        return (
          <>
            added{" "}
            <Link
              href={`/book/${activity.bookId}`}
              className="font-medium hover:text-[#7047EB]"
            >
              {activity.book?.title}
            </Link>{" "}
            to {activity.shelfName}
          </>
        );
      case "review":
        return (
          <>
            reviewed{" "}
            <Link
              href={`/book/${activity.bookId}`}
              className="font-medium hover:text-[#7047EB]"
            >
              {activity.book?.title}
            </Link>
          </>
        );
      case "progress":
        return activity.finishedAt ? (
          <>
            finished reading{" "}
            <Link
              href={`/book/${activity.bookId}`}
              className="font-medium hover:text-[#7047EB]"
            >
              {activity.book?.title}
            </Link>
          </>
        ) : (
          <>
            updated progress on{" "}
            <Link
              href={`/book/${activity.bookId}`}
              className="font-medium hover:text-[#7047EB]"
            >
              {activity.book?.title}
            </Link>
          </>
        );
    }
  };

  return (
    <div className="bg-[var(--card-bg)] rounded-lg border border-[var(--card-border)] p-4">
      <div className="flex gap-3">
        <Link href={`/user/${activity.userId}`}>
          <Avatar
            src={activity.user.avatarUrl}
            name={activity.user.name}
            size="md"
          />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {getIcon()}
            <Link
              href={`/user/${activity.userId}`}
              className="font-medium text-[var(--foreground)] hover:text-[#7047EB]"
            >
              {activity.user.name}
            </Link>
            <span className="text-[var(--foreground-secondary)]">{getMessage()}</span>
          </div>
          <p className="text-xs text-[var(--foreground-secondary)] mt-1">
            {formatDistanceToNow(new Date(activity.createdAt), {
              addSuffix: true,
            })}
          </p>

          {/* Show rating for reviews */}
          {activity.type === "review" && activity.rating && (
            <div className="mt-2">
              <StarRating rating={activity.rating} size="sm" />
              {activity.content && (
                <p className="mt-1 text-sm text-[var(--foreground-secondary)] line-clamp-2">
                  {activity.content}
                </p>
              )}
            </div>
          )}

          {/* Show book cover */}
          {activity.book?.coverUrl && (
            <Link href={`/book/${activity.bookId}`} className="block mt-3">
              <div className="w-16 h-24 relative rounded overflow-hidden">
                <Image
                  src={activity.book.coverUrl}
                  alt={activity.book.title}
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
