import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--background)] flex flex-col">
      {/* UX-29. A keyboard or screen-reader user passed the logo, six nav
          links, the search box, the theme toggle and the avatar before
          reaching the content — on every page. Visible only when focused, so
          it costs a pointer user nothing. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-[var(--card-bg)] focus:px-4 focus:py-2 focus:text-[var(--foreground)] focus:shadow-lg"
      >
        Skip to content
      </a>
      <Navbar />
      {/* tabIndex -1 so the skip link can move focus here, not just the
          viewport: without it the next Tab resumes from the navbar. */}
      <main id="main" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}
