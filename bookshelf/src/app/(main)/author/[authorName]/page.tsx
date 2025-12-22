import Link from "next/link";
import Image from "next/image";
import { getAuthorByName, getBooksForAuthor } from "@/server/authors";
import { getCurrentUser } from "@/lib/session";
import { User, BookOpen, MapPin } from "lucide-react";
import AuthorLocationsSection from "@/components/authors/AuthorLocationsSection";

interface Props {
  params: Promise<{ authorName: string }>;
}

export default async function AuthorPage({ params }: Props) {
  const { authorName } = await params;
  const decodedName = decodeURIComponent(authorName);

  const [author, books, user] = await Promise.all([
    getAuthorByName(decodedName),
    getBooksForAuthor(decodedName),
    getCurrentUser(),
  ]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Author Header */}
      <div className="flex flex-col md:flex-row gap-6 mb-8">
        {/* Photo */}
        <div className="flex-shrink-0">
          <div className="w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden bg-gray-100 mx-auto md:mx-0 flex items-center justify-center">
            {author?.photoUrl ? (
              <Image
                src={author.photoUrl}
                alt={decodedName}
                width={160}
                height={160}
                className="object-cover"
              />
            ) : (
              <User className="w-16 h-16 text-gray-300" />
            )}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 text-center md:text-left">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">
            {decodedName}
          </h1>

          {author?.birthYear && (
            <p className="text-gray-500 mb-4">
              {author.birthYear}
              {author.deathYear ? ` - ${author.deathYear}` : " - Present"}
            </p>
          )}

          {author?.bio && (
            <p className="text-gray-600 max-w-2xl">{author.bio}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-4 justify-center md:justify-start text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <BookOpen className="h-4 w-4" />
              {books.length} book{books.length !== 1 ? "s" : ""} in library
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              {author?.locations.length || 0} location{(author?.locations.length || 0) !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="grid md:grid-cols-2 gap-8">
        {/* Author Locations - Wikipedia style */}
        <div>
          <AuthorLocationsSection
            authorName={decodedName}
            currentUserId={user?.id}
          />
        </div>

        {/* Books by this author */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-[#7047EB]" />
            Books in Your Library
          </h3>

          {books.length > 0 ? (
            <div className="space-y-3">
              {books.map((book) => (
                <Link
                  key={book.id}
                  href={`/book/${book.id}`}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="w-12 h-16 flex-shrink-0 rounded overflow-hidden bg-gray-100">
                    {book.coverUrl ? (
                      <Image
                        src={book.coverUrl}
                        alt={book.title}
                        width={48}
                        height={64}
                        className="object-cover w-full h-full"
                        unoptimized
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-2xl">
                        📚
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {book.title}
                    </p>
                    {book.publishedDate && (
                      <p className="text-sm text-gray-500">
                        {book.publishedDate}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <BookOpen className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No books by this author in your library</p>
              <Link
                href="/search"
                className="text-sm text-[#7047EB] hover:text-[#5a35d4] font-medium mt-2 inline-block"
              >
                Search for books
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
