import Link from "next/link";
import Image from "next/image";
import { Book } from "@prisma/client";
import StarRating from "@/components/ui/StarRating";

interface BookCardProps {
  book: Book & {
    averageRating?: number;
    _count?: {
      reviews?: number;
      shelfItems?: number;
    };
  };
  showRating?: boolean;
}

export default function BookCard({ book, showRating = true }: BookCardProps) {
  return (
    <Link href={`/book/${book.id}`} className="group block">
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
        <div className="aspect-[2/3] relative bg-gray-100">
          {book.coverUrl ? (
            <Image
              src={book.coverUrl}
              alt={book.title}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
              unoptimized
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-amber-100 to-orange-100">
              <div className="text-center p-4">
                <span className="text-4xl mb-2 block">📚</span>
                <span className="text-sm text-amber-700 font-medium line-clamp-2">
                  {book.title}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="p-3">
          <h3 className="font-medium text-gray-900 line-clamp-1 group-hover:text-amber-600 transition-colors">
            {book.title}
          </h3>
          <p className="text-sm text-gray-500 line-clamp-1">{book.author}</p>
          {showRating && book.averageRating !== undefined && (
            <div className="mt-2 flex items-center gap-1">
              <StarRating rating={Math.round(book.averageRating)} size="sm" />
              <span className="text-xs text-gray-500">
                ({book._count?.reviews || 0})
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
