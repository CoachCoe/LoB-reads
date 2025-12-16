import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { getUserShelves } from "@/server/shelves";
import { getUserReadingStats } from "@/server/progress";
import ShelfSection from "./ShelfSection";
import Card, { CardContent } from "@/components/ui/Card";
import { BookOpen, BookMarked, Trophy } from "lucide-react";

export default async function MyBooksPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?callbackUrl=/my-books");
  }

  const [shelves, stats] = await Promise.all([
    getUserShelves(user.id),
    getUserReadingStats(user.id),
  ]);

  // Separate default and custom shelves
  const defaultShelves = shelves.filter((s) => s.isDefault);
  const customShelves = shelves.filter((s) => !s.isDefault);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">My Books</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="p-3 bg-amber-100 rounded-lg">
              <BookOpen className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {stats.currentlyReading}
              </p>
              <p className="text-sm text-gray-500">Currently Reading</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="p-3 bg-green-100 rounded-lg">
              <BookMarked className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {stats.booksRead}
              </p>
              <p className="text-sm text-gray-500">Books Read</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="p-3 bg-purple-100 rounded-lg">
              <Trophy className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {stats.pagesRead.toLocaleString()}
              </p>
              <p className="text-sm text-gray-500">Pages Read</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Default shelves */}
      <div className="space-y-8">
        {defaultShelves.map((shelf) => (
          <ShelfSection key={shelf.id} shelf={shelf} />
        ))}
      </div>

      {/* Custom shelves */}
      {customShelves.length > 0 && (
        <div className="mt-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            Custom Shelves
          </h2>
          <div className="space-y-8">
            {customShelves.map((shelf) => (
              <ShelfSection key={shelf.id} shelf={shelf} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {shelves.every((s) => s._count?.shelfItems === 0) && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <BookOpen className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Your library is empty
          </h2>
          <p className="text-gray-500 mb-4">
            Start by searching for books to add to your shelves
          </p>
          <Link
            href="/search"
            className="inline-flex items-center px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
          >
            Discover Books
          </Link>
        </div>
      )}
    </div>
  );
}
