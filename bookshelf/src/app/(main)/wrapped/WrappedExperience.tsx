"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Share2, BookOpen, Star, Clock, Trophy, Heart } from "lucide-react";
import { WrappedStats } from "@/server/wrapped";
import Button from "@/components/ui/Button";

interface WrappedExperienceProps {
  stats: WrappedStats;
  userName: string;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const GRADIENTS = [
  "from-purple-600 via-pink-600 to-red-500",
  "from-blue-600 via-purple-600 to-pink-500",
  "from-emerald-500 via-teal-500 to-cyan-500",
  "from-orange-500 via-red-500 to-pink-500",
  "from-indigo-600 via-purple-600 to-pink-600",
  "from-rose-500 via-pink-500 to-purple-500",
  "from-amber-500 via-orange-500 to-red-500",
];

export default function WrappedExperience({ stats, userName }: WrappedExperienceProps) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const slides = [
    // Intro slide
    {
      gradient: GRADIENTS[0],
      content: (
        <div className="text-center">
          <div className="text-6xl mb-6">📚</div>
          <h1 className="text-4xl md:text-6xl font-bold mb-4">
            Your {stats.year} Wrapped
          </h1>
          <p className="text-xl text-white/80">
            Hey {userName}, let&apos;s look back at your reading journey
          </p>
        </div>
      ),
    },
    // Books read
    {
      gradient: GRADIENTS[1],
      content: (
        <div className="text-center">
          <BookOpen className="h-16 w-16 mx-auto mb-6 opacity-80" />
          <p className="text-xl text-white/80 mb-2">This year you read</p>
          <div className="text-8xl md:text-9xl font-black mb-4">
            {stats.booksRead}
          </div>
          <p className="text-2xl font-medium">
            {stats.booksRead === 1 ? "book" : "books"}
          </p>
          {stats.booksRead > 0 && (
            <p className="text-lg text-white/70 mt-4">
              That&apos;s {stats.averageBooksPerMonth} books per month!
            </p>
          )}
        </div>
      ),
    },
    // Pages read
    {
      gradient: GRADIENTS[2],
      content: (
        <div className="text-center">
          <div className="text-6xl mb-6">📖</div>
          <p className="text-xl text-white/80 mb-2">You turned</p>
          <div className="text-7xl md:text-8xl font-black mb-4">
            {stats.pagesRead.toLocaleString()}
          </div>
          <p className="text-2xl font-medium">pages</p>
          {stats.pagesRead > 0 && (
            <p className="text-lg text-white/70 mt-4">
              That&apos;s like reading the entire Harry Potter series{" "}
              {Math.floor(stats.pagesRead / 4224)} times!
            </p>
          )}
        </div>
      ),
    },
    // Top genre
    {
      gradient: GRADIENTS[3],
      content: (
        <div className="text-center">
          <Heart className="h-16 w-16 mx-auto mb-6 opacity-80" />
          <p className="text-xl text-white/80 mb-2">Your favorite genre was</p>
          <div className="text-5xl md:text-6xl font-black mb-6">
            {stats.favoriteGenre || "Exploring"}
          </div>
          {stats.topGenres.length > 1 && (
            <div className="space-y-2">
              <p className="text-lg text-white/70">You also enjoyed:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {stats.topGenres.slice(1, 4).map((g) => (
                  <span
                    key={g.genre}
                    className="px-3 py-1 bg-white/20 rounded-full text-sm"
                  >
                    {g.genre}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ),
    },
    // Top author
    {
      gradient: GRADIENTS[4],
      content: (
        <div className="text-center">
          <div className="text-6xl mb-6">✍️</div>
          <p className="text-xl text-white/80 mb-2">Your top author was</p>
          <div className="text-4xl md:text-5xl font-black mb-4">
            {stats.favoriteAuthor || "Many great writers"}
          </div>
          {stats.topAuthors.length > 0 && stats.topAuthors[0].count > 1 && (
            <p className="text-lg text-white/70">
              You read {stats.topAuthors[0].count} of their books!
            </p>
          )}
          {stats.topAuthors.length > 1 && (
            <div className="mt-6 space-y-2">
              <p className="text-sm text-white/60">Other favorites:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {stats.topAuthors.slice(1, 4).map((a) => (
                  <span
                    key={a.author}
                    className="px-3 py-1 bg-white/20 rounded-full text-sm"
                  >
                    {a.author}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ),
    },
    // Reading by month chart
    {
      gradient: GRADIENTS[5],
      content: (
        <div className="text-center">
          <Clock className="h-12 w-12 mx-auto mb-4 opacity-80" />
          <p className="text-xl text-white/80 mb-6">Your reading throughout the year</p>
          <div className="flex items-end justify-center gap-1 h-40 mb-4">
            {stats.readingByMonth.map((m) => {
              const maxCount = Math.max(...stats.readingByMonth.map((x) => x.count), 1);
              const height = m.count > 0 ? (m.count / maxCount) * 100 : 4;
              return (
                <div key={m.month} className="flex flex-col items-center">
                  <div
                    className="w-6 md:w-8 bg-white/80 rounded-t transition-all duration-500"
                    style={{ height: `${height}%`, minHeight: "4px" }}
                  />
                  <span className="text-xs mt-2 text-white/60">
                    {MONTH_NAMES[m.month]}
                  </span>
                </div>
              );
            })}
          </div>
          {stats.readingByMonth.some((m) => m.count > 0) && (
            <p className="text-sm text-white/70">
              Your best month was{" "}
              {MONTH_NAMES[
                stats.readingByMonth.reduce((best, m) =>
                  m.count > stats.readingByMonth[best].count ? m.month : best
                , 0)
              ]}!
            </p>
          )}
        </div>
      ),
    },
    // Top rated books
    {
      gradient: GRADIENTS[6],
      content: (
        <div className="text-center">
          <Star className="h-12 w-12 mx-auto mb-4 opacity-80" />
          <p className="text-xl text-white/80 mb-6">Your top rated books</p>
          {stats.topRatedBooks.length > 0 ? (
            <div className="space-y-3 max-w-md mx-auto">
              {stats.topRatedBooks.slice(0, 3).map((book, index) => (
                <div
                  key={book.title}
                  className="flex items-center gap-4 bg-white/10 rounded-lg p-3"
                >
                  <span className="text-2xl font-bold opacity-60">
                    {index + 1}
                  </span>
                  <div className="flex-1 text-left">
                    <p className="font-semibold line-clamp-1">{book.title}</p>
                    <p className="text-sm text-white/70">{book.author}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    <span>{book.rating}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-white/70">
              Rate some books to see your favorites here!
            </p>
          )}
        </div>
      ),
    },
    // Summary slide
    {
      gradient: GRADIENTS[0],
      content: (
        <div className="text-center">
          <Trophy className="h-16 w-16 mx-auto mb-6 text-yellow-400" />
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            {stats.year} in Review
          </h2>
          <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto mb-8">
            <div className="bg-white/10 rounded-lg p-4">
              <div className="text-3xl font-bold">{stats.booksRead}</div>
              <div className="text-sm text-white/70">Books</div>
            </div>
            <div className="bg-white/10 rounded-lg p-4">
              <div className="text-3xl font-bold">{stats.pagesRead.toLocaleString()}</div>
              <div className="text-sm text-white/70">Pages</div>
            </div>
            <div className="bg-white/10 rounded-lg p-4">
              <div className="text-3xl font-bold">{stats.reviewsWritten}</div>
              <div className="text-sm text-white/70">Reviews</div>
            </div>
            <div className="bg-white/10 rounded-lg p-4">
              <div className="text-3xl font-bold">{stats.topGenres.length}</div>
              <div className="text-sm text-white/70">Genres</div>
            </div>
          </div>
          <p className="text-lg text-white/80">
            Here&apos;s to even more reading in {stats.year + 1}! 📚
          </p>
        </div>
      ),
    },
  ];

  const nextSlide = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    }
  };

  const prevSlide = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
    }
  };

  const handleShare = async () => {
    const shareText = `My ${stats.year} Life on Books Wrapped:\n📚 ${stats.booksRead} books read\n📖 ${stats.pagesRead.toLocaleString()} pages\n❤️ Favorite genre: ${stats.favoriteGenre || "Various"}\n\nCheck out your reading stats at Life on Books!`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `My ${stats.year} Life on Books Wrapped`,
          text: shareText,
        });
      } catch {
        // User cancelled or error
      }
    } else {
      await navigator.clipboard.writeText(shareText);
      alert("Copied to clipboard!");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {/* Progress bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex gap-1 p-2">
        {slides.map((_, index) => (
          <div
            key={index}
            className="h-1 flex-1 rounded-full bg-white/30 overflow-hidden"
          >
            <div
              className={`h-full bg-white transition-all duration-300 ${
                index < currentSlide
                  ? "w-full"
                  : index === currentSlide
                  ? "w-full"
                  : "w-0"
              }`}
            />
          </div>
        ))}
      </div>

      {/* Slide content */}
      <div
        className={`h-full flex items-center justify-center p-8 bg-gradient-to-br ${slides[currentSlide].gradient} transition-all duration-500`}
      >
        <div className="max-w-2xl w-full text-white animate-fade-in">
          {slides[currentSlide].content}
        </div>
      </div>

      {/* Navigation */}
      <div className="absolute bottom-0 left-0 right-0 p-6 flex items-center justify-between">
        <button
          onClick={prevSlide}
          disabled={currentSlide === 0}
          className="p-2 rounded-full bg-white/20 disabled:opacity-30 hover:bg-white/30 transition-colors"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>

        <div className="flex items-center gap-4">
          {currentSlide === slides.length - 1 && (
            <Button
              onClick={handleShare}
              variant="secondary"
              className="flex items-center gap-2 bg-white text-gray-900 hover:bg-gray-100"
            >
              <Share2 className="h-4 w-4" />
              Share
            </Button>
          )}
        </div>

        <button
          onClick={nextSlide}
          disabled={currentSlide === slides.length - 1}
          className="p-2 rounded-full bg-white/20 disabled:opacity-30 hover:bg-white/30 transition-colors"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      {/* Click zones for navigation */}
      <div className="absolute inset-0 flex">
        <div className="w-1/3 cursor-pointer" onClick={prevSlide} />
        <div className="w-1/3" />
        <div className="w-1/3 cursor-pointer" onClick={nextSlide} />
      </div>

      {/* Top right buttons */}
      <div className="absolute top-4 right-4 flex items-center gap-2 z-20">
        {/* Projections link */}
        <Link
          href="/wrapped/projections"
          className="px-4 py-2 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white font-medium text-sm transition-colors"
        >
          {stats.year + 1} Projections
        </Link>
        {/* Close button */}
        <Link
          href="/"
          className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
        >
          <span className="sr-only">Close</span>
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
