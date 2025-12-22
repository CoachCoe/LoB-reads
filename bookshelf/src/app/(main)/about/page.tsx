import Link from "next/link";
import {
  BookOpen,
  Search,
  Users,
  Sparkles,
  MapPin,
  FileUp,
  Star,
  Library,
  TrendingUp,
  Globe,
  UserCircle,
  Moon,
  Rss,
  BookMarked,
} from "lucide-react";

const features = [
  {
    icon: Library,
    title: "Personal Bookshelves",
    description:
      "Organize your reading with three default shelves: Want to Read, Currently Reading, and Read. Create unlimited custom shelves to categorize your library exactly how you want.",
  },
  {
    icon: BookOpen,
    title: "Reading Progress Tracking",
    description:
      "Track your progress through each book page by page. See how far you've come and stay motivated to finish your current reads.",
  },
  {
    icon: Search,
    title: "Book Search",
    description:
      "Search millions of titles through the Open Library API. Find books by title, author, or ISBN. View detailed book information including descriptions, page counts, and cover images.",
  },
  {
    icon: Star,
    title: "Reviews & Ratings",
    description:
      "Rate books on a 5-star scale and write detailed reviews. Share your thoughts with the community and help others discover great reads.",
  },
  {
    icon: Users,
    title: "Social Features",
    description:
      "Follow friends and fellow book lovers. See what others are reading, view their reviews, and build your reading community.",
  },
  {
    icon: UserCircle,
    title: "User Profiles",
    description:
      "Customizable profile with avatar upload. View your reading statistics, recent activity, and all your reviews in one place.",
  },
  {
    icon: Rss,
    title: "Activity Feed",
    description:
      "Stay updated with a personalized feed showing what people you follow are reading, reviewing, and adding to their shelves.",
  },
  {
    icon: BookMarked,
    title: "Author Pages",
    description:
      "Explore author pages showing all their books in our database. Discover new titles from your favorite writers.",
  },
  {
    icon: Sparkles,
    title: "Wrapped - Year in Review",
    description:
      "Get personalized reading statistics at year end. See total books read, pages turned, favorite genres, top authors, reading streaks, and a beautiful slideshow of your reading journey.",
  },
  {
    icon: TrendingUp,
    title: "Reading Projections",
    description:
      "Track your year-to-date reading progress and see projections for year end. Know if you're on track for your reading goals with pace calculations and goal tracking.",
  },
  {
    icon: MapPin,
    title: "Interactive Map",
    description:
      "Explore where your books are set on an interactive world map. Crowdsourced location data lets the community add book settings and discover stories from around the globe.",
  },
  {
    icon: Globe,
    title: "Fictional Worlds",
    description:
      "Explore fantasy and sci-fi universes with dedicated fictional world pages. Upload custom maps for worlds like Middle-earth, Westeros, or the Cosmere.",
  },
  {
    icon: FileUp,
    title: "Goodreads Import",
    description:
      "Easily migrate your existing library from Goodreads. Import your CSV export including books, ratings, shelves, and reading history with one click.",
  },
  {
    icon: Moon,
    title: "Dark Mode",
    description:
      "Easy on the eyes with a beautiful dark mode. Switch between light and dark themes with a single click.",
  },
];

export default function AboutPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      {/* Hero */}
      <div className="text-center mb-16">
        <h1 className="text-4xl font-bold text-[var(--foreground)] mb-4">
          About Life on Books
        </h1>
        <p className="text-xl text-[var(--foreground-secondary)] max-w-2xl mx-auto mb-6">
          A modern reading tracker for book lovers. Track your library, discover new stories, connect with readers, and visualize your reading journey.
        </p>
        <p className="text-sm text-[var(--foreground-secondary)] max-w-2xl mx-auto">
          Built with Next.js 16, React 19, Prisma, PostgreSQL, and Tailwind CSS.
        </p>
      </div>

      {/* Features Grid */}
      <div className="mb-16">
        <h2 className="text-2xl font-semibold text-[var(--foreground)] mb-8 text-center">
          Features
        </h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="p-5 bg-[var(--card-bg)] rounded-xl border border-[var(--card-border)] hover:border-[#7047EB]/30 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 bg-[#7047EB]/10 rounded-lg shrink-0">
                  <feature.icon className="h-5 w-5 text-[#7047EB]" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[var(--foreground)] mb-1">
                    {feature.title}
                  </h3>
                  <p className="text-[var(--foreground-secondary)] text-sm leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tech Stack */}
      <div className="mb-16">
        <h2 className="text-2xl font-semibold text-[var(--foreground)] mb-6 text-center">
          Tech Stack
        </h2>
        <div className="flex flex-wrap justify-center gap-3">
          {[
            "Next.js 16",
            "React 19",
            "TypeScript",
            "Prisma ORM",
            "PostgreSQL",
            "NextAuth.js",
            "Tailwind CSS",
            "Open Library API",
            "Leaflet Maps",
            "Vercel Blob",
          ].map((tech) => (
            <span
              key={tech}
              className="px-4 py-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-full text-sm text-[var(--foreground)]"
            >
              {tech}
            </span>
          ))}
        </div>
      </div>

      {/* API Integrations */}
      <div className="mb-16">
        <h2 className="text-2xl font-semibold text-[var(--foreground)] mb-6 text-center">
          Integrations
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="p-4 bg-[var(--card-bg)] rounded-xl border border-[var(--card-border)] text-center">
            <h3 className="font-semibold text-[var(--foreground)] mb-2">Open Library</h3>
            <p className="text-sm text-[var(--foreground-secondary)]">
              Book metadata, covers, and search powered by Open Library&apos;s open API
            </p>
          </div>
          <div className="p-4 bg-[var(--card-bg)] rounded-xl border border-[var(--card-border)] text-center">
            <h3 className="font-semibold text-[var(--foreground)] mb-2">Goodreads</h3>
            <p className="text-sm text-[var(--foreground-secondary)]">
              Import your existing library via CSV export from Goodreads
            </p>
          </div>
          <div className="p-4 bg-[var(--card-bg)] rounded-xl border border-[var(--card-border)] text-center">
            <h3 className="font-semibold text-[var(--foreground)] mb-2">Vercel Blob</h3>
            <p className="text-sm text-[var(--foreground-secondary)]">
              Cloud storage for avatar uploads and fictional world maps
            </p>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="text-center">
        <p className="text-[var(--foreground-secondary)] mb-6">
          Ready to start your reading journey?
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#7047EB] text-white rounded-full font-medium hover:bg-[#5a35d4] transition-colors"
          >
            Get Started Free
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--card-bg)] text-[var(--foreground)] border border-[var(--card-border)] rounded-full font-medium hover:border-[#7047EB]/50 transition-colors"
          >
            Explore the App
          </Link>
        </div>
      </div>
    </div>
  );
}
