import {
  BookOpen,
  Search,
  Users,
  Sparkles,
  MapPin,
  FileUp,
} from "lucide-react";

const features = [
  {
    icon: BookOpen,
    title: "Track Your Books",
    description:
      "Organize your reading with customizable shelves. Track what you want to read, what you're currently reading, and everything you've finished.",
  },
  {
    icon: Search,
    title: "Discover New Books",
    description:
      "Search millions of titles through Open Library. Find your next great read based on genre, author, or recommendations from the community.",
  },
  {
    icon: Users,
    title: "Connect with Readers",
    description:
      "Follow friends and fellow book lovers. Share reviews, see what others are reading, and build your reading community.",
  },
  {
    icon: Sparkles,
    title: "Your Year in Review",
    description:
      "Get personalized reading statistics with Wrapped. See your total books, pages read, favorite genres, and reading streaks.",
  },
  {
    icon: MapPin,
    title: "Explore the Map",
    description:
      "Discover where your favorite books are set and where authors are from. Explore fictional worlds with custom map views.",
  },
  {
    icon: FileUp,
    title: "Import from Goodreads",
    description:
      "Easily bring your existing library. Import your Goodreads data including books, ratings, shelves, and reading history.",
  },
];

export default function AboutPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      {/* Hero */}
      <div className="text-center mb-16">
        <h1 className="text-4xl font-semibold text-[var(--foreground)] mb-4">
          About Life on Books
        </h1>
        <p className="text-xl text-[var(--foreground-secondary)] max-w-2xl mx-auto">
          A place for readers to track their journey, discover new stories, and
          connect with a community of book lovers.
        </p>
      </div>

      {/* Features */}
      <div className="grid gap-8 md:grid-cols-2">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="p-6 bg-[var(--card-bg)] rounded-2xl border border-[var(--card-border)]"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 bg-[#7047EB]/10 rounded-xl">
                <feature.icon className="h-6 w-6 text-[#7047EB]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--foreground)] mb-2">
                  {feature.title}
                </h2>
                <p className="text-[var(--foreground-secondary)] text-sm leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="mt-16 text-center">
        <p className="text-[var(--foreground-secondary)] mb-6">
          Ready to start your reading journey?
        </p>
        <a
          href="/register"
          className="inline-flex items-center gap-2 px-6 py-3 bg-[#7047EB] text-white rounded-full font-medium hover:bg-[#5a35d4] transition-colors"
        >
          Get Started Free
        </a>
      </div>
    </div>
  );
}
