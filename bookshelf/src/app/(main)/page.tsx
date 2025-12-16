import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { getPopularBooks, searchLocalBooks } from "@/server/books";
import { getActivityFeed } from "@/server/users";
import { getUserCurrentlyReading } from "@/server/progress";
import BookGrid from "@/components/books/BookGrid";
import ActivityFeed from "@/components/social/ActivityFeed";
import CurrentlyReadingCard from "@/components/books/CurrentlyReadingCard";
import Button from "@/components/ui/Button";
import { BookOpen, Search, Users } from "lucide-react";

export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) {
    return <LandingPage />;
  }

  const [popularBooks, feed, currentlyReading] = await Promise.all([
    getPopularBooks(10),
    getActivityFeed(user.id, 10),
    getUserCurrentlyReading(user.id),
  ]);

  // If no popular books, show all books
  const booksToShow =
    popularBooks.length > 0
      ? popularBooks
      : await searchLocalBooks("", 10);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Currently reading */}
          {currentlyReading.length > 0 && (
            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-4">
                Continue Reading
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {currentlyReading.slice(0, 2).map((progress) => (
                  <CurrentlyReadingCard
                    key={progress.id}
                    progress={progress}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Activity feed */}
          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              Activity Feed
            </h2>
            {feed.length > 0 ? (
              <ActivityFeed activities={feed} />
            ) : (
              <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
                <Users className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 mb-4">
                  Follow other readers to see their activity here
                </p>
                <Link href="/search?tab=users">
                  <Button variant="outline">Find Readers</Button>
                </Link>
              </div>
            )}
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-8">
          {/* Popular books */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">
                Popular This Week
              </h2>
              <Link
                href="/search"
                className="text-sm text-amber-600 hover:text-amber-700"
              >
                See all
              </Link>
            </div>
            <div className="space-y-3">
              {booksToShow.slice(0, 5).map((book, index) => (
                <Link
                  key={book.id}
                  href={`/book/${book.id}`}
                  className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-gray-50"
                >
                  <span className="text-lg font-bold text-gray-300 w-6">
                    {index + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-gray-900 truncate">
                      {book.title}
                    </h3>
                    <p className="text-sm text-gray-500 truncate">
                      {book.author}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function LandingPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)]">
      {/* Hero section */}
      <section className="bg-gradient-to-br from-amber-50 to-orange-50 py-20">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            Track Your Reading Journey
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            Discover new books, track your reading progress, and connect with
            other readers. Your personal library, organized beautifully.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register">
              <Button size="lg" className="w-full sm:w-auto">
                Get Started Free
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" size="lg" className="w-full sm:w-auto">
                Sign In
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            Everything You Need
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <BookOpen className="h-8 w-8 text-amber-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Track Your Books
              </h3>
              <p className="text-gray-600">
                Organize books into shelves, track your reading progress, and
                never lose track of what you want to read next.
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="h-8 w-8 text-amber-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Discover New Books
              </h3>
              <p className="text-gray-600">
                Search millions of books, read reviews from other readers, and
                find your next favorite read.
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="h-8 w-8 text-amber-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Connect with Readers
              </h3>
              <p className="text-gray-600">
                Follow friends, share reviews, and see what others are reading
                in your community.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
