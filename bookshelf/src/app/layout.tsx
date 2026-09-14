import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";
import SessionProvider from "@/components/providers/SessionProvider";
import ThemeProvider from "@/components/providers/ThemeProvider";
import ToastProvider from "@/components/providers/ToastProvider";

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-roboto",
});

/**
 * The app's own public origin, for absolute URLs in metadata.
 *
 * `metadataBase` is what turns a relative openGraph image into the absolute URL
 * a link unfurler needs; without it Next warns and emits a localhost URL, which
 * is why every link shared from this product rendered as a bare URL. Reusing
 * NEXTAUTH_URL rather than adding a variable: both name the same thing, and
 * deploy:verify already treats them as one (BASE_URL: ${{ secrets.NEXTAUTH_URL }}).
 */
export const SITE_ORIGIN = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    // Per-page titles say what the page is; the suffix says where you are.
    // Twelve of fifteen pages used to inherit one string, so eight open tabs
    // were indistinguishable.
    default: "Life on Books — every book you've read, and everywhere it took you",
    template: "%s · Life on Books",
  },
  description:
    "A reading tracker built around place. Bring your Goodreads library, then watch your reading fill in the map.",
  applicationName: "Life on Books",
  openGraph: {
    type: "website",
    siteName: "Life on Books",
    title: "Life on Books",
    description:
      "A reading tracker built around place. Bring your Goodreads library, then watch your reading fill in the map.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Life on Books",
    description:
      "A reading tracker built around place. Bring your Goodreads library, then watch your reading fill in the map.",
  },
  // The catalog is Open Library's and rebuilt monthly; the reader's own pages
  // are theirs. Neither is a claim worth making in a meta tag, but the crawl
  // policy in robots.ts is, and this is the pair it works with.
  robots: { index: true, follow: true },
};

/**
 * Applies the saved theme before first paint.
 *
 * The provider previously set this class when its module evaluated, which
 * happens after the page has already painted — so a dark-mode user saw a
 * white flash on every navigation. Falling back to the OS preference also
 * means a first-time visitor on a dark system starts in dark mode.
 */
const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var dark = stored
      ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeScript }}
          suppressHydrationWarning
        />
      </head>
      <body className={`${roboto.variable} font-sans antialiased`}>
        <SessionProvider>
          <ThemeProvider>
            <ToastProvider>{children}</ToastProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
