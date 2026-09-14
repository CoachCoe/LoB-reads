/**
 * The app's own public origin, for absolute URLs in metadata.
 *
 * `metadataBase` is what turns a relative openGraph image into the absolute URL
 * a link unfurler needs; without it Next warns and emits a localhost URL, which
 * is why every link shared from this product rendered as a bare URL.
 *
 * Reuses NEXTAUTH_URL rather than adding a variable: both name the same thing,
 * and deploy.yml already treats them as one (BASE_URL: secrets.NEXTAUTH_URL).
 *
 * It lives here rather than in `app/layout.tsx`, where it started, because
 * `robots.ts` and `sitemap.ts` need it — and importing them from the layout
 * dragged the root layout's whole module graph into a route that emits plain
 * text: a Google font loader, the global stylesheet and three client providers,
 * to serve eleven lines of robots.txt.
 */
export const SITE_ORIGIN = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
