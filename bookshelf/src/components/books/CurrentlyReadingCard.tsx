import Link from "next/link";
import Image from "next/image";
import { ReadingProgress, Book } from "@prisma/client";
import ProgressBar from "@/components/ui/ProgressBar";

interface CurrentlyReadingCardProps {
  progress: ReadingProgress & {
    book: Book;
  };
}

export default function CurrentlyReadingCard({
  progress,
}: CurrentlyReadingCardProps) {
  const percentage =
    progress.book.pageCount && progress.book.pageCount > 0
      ? Math.round((progress.currentPage / progress.book.pageCount) * 100)
      : 0;

  return (
    <Link href={`/book/${progress.bookId}`}>
      <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
        <div className="flex gap-4">
          <div className="w-16 h-24 relative flex-shrink-0 rounded overflow-hidden">
            {progress.book.coverUrl ? (
              <Image
                src={progress.book.coverUrl}
                alt={progress.book.title}
                fill
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
                <span className="text-2xl">📚</span>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-gray-900 truncate">
              {progress.book.title}
            </h3>
            <p className="text-sm text-gray-500 truncate mb-2">
              {progress.book.author}
            </p>
            <ProgressBar
              value={progress.currentPage}
              max={progress.book.pageCount || 100}
              showLabel={false}
            />
            <p className="text-xs text-gray-500 mt-1">
              {percentage}% complete
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}
