import Image from "next/image";
import { notFound } from "next/navigation";
import { getBookById } from "@/server/books";
import { getCurrentUser } from "@/lib/session";
import { getUserReviewForBook } from "@/server/reviews";
import StarRating from "@/components/ui/StarRating";
import Badge from "@/components/ui/Badge";
import AddToShelfButton from "@/components/books/AddToShelfButton";
import ReadingProgressSection from "@/components/books/ReadingProgressSection";
import ReviewCard from "@/components/reviews/ReviewCard";
import BookReviewSection from "./BookReviewSection";

interface Props {
  params: Promise<{ bookId: string }>;
}

export default async function BookDetailPage({ params }: Props) {
  const { bookId } = await params;
  const [book, user] = await Promise.all([
    getBookById(bookId),
    getCurrentUser(),
  ]);

  if (!book) {
    notFound();
  }

  const userReview = user
    ? await getUserReviewForBook(user.id, bookId)
    : null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Book header */}
      <div className="flex flex-col md:flex-row gap-8 mb-8">
        {/* Cover */}
        <div className="flex-shrink-0">
          <div className="w-48 md:w-64 aspect-[2/3] relative rounded-lg overflow-hidden shadow-lg mx-auto md:mx-0">
            {book.coverUrl ? (
              <Image
                src={book.coverUrl}
                alt={book.title}
                fill
                className="object-cover"
                priority
                unoptimized
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-amber-100 to-orange-100">
                <div className="text-center p-4">
                  <span className="text-6xl mb-2 block">📚</span>
                  <span className="text-sm text-amber-700 font-medium">
                    {book.title}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="flex-1">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">
            {book.title}
          </h1>
          <p className="text-xl text-gray-600 mb-4">by {book.author}</p>

          {/* Rating */}
          <div className="flex items-center gap-3 mb-4">
            <StarRating
              rating={Math.round(book.averageRating || 0)}
              size="lg"
            />
            <span className="text-lg font-medium text-gray-700">
              {book.averageRating?.toFixed(1) || "—"}
            </span>
            <span className="text-gray-500">
              ({book._count?.reviews || 0} reviews)
            </span>
          </div>

          {/* Genres */}
          {book.genres.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {book.genres.map((genre) => (
                <Badge key={genre} variant="primary">
                  {genre}
                </Badge>
              ))}
            </div>
          )}

          {/* Meta info */}
          <div className="text-sm text-gray-500 space-y-1 mb-6">
            {book.pageCount && <p>{book.pageCount} pages</p>}
            {book.publishedDate && <p>First published: {book.publishedDate}</p>}
            {book.isbn && <p>ISBN: {book.isbn}</p>}
          </div>

          {/* Actions */}
          {user && (
            <div className="flex flex-wrap gap-3 mb-6">
              <AddToShelfButton bookId={book.id} />
              <ReadingProgressSection
                bookId={book.id}
                pageCount={book.pageCount}
              />
            </div>
          )}

          {/* Description */}
          {book.description && (
            <div className="prose prose-gray max-w-none">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">
                About this book
              </h2>
              <p className="text-gray-600 whitespace-pre-wrap">
                {book.description}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Reviews section */}
      <div className="border-t border-gray-200 pt-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">
          Reviews
        </h2>

        {user && (
          <div className="bg-gray-50 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {userReview ? "Your Review" : "Write a Review"}
            </h3>
            <BookReviewSection
              bookId={book.id}
              existingReview={userReview}
            />
          </div>
        )}

        {/* Other reviews */}
        <div className="space-y-4">
          {book.reviews
            ?.filter((r) => r.userId !== user?.id)
            .map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}

          {(!book.reviews || book.reviews.length === 0) && (
            <p className="text-center text-gray-500 py-8">
              No reviews yet. Be the first to review this book!
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
