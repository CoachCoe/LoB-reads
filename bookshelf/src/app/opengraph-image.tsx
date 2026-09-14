import { ImageResponse } from "next/og";

/**
 * The card every shared link unfurls to.
 *
 * There was none, so a link posted to Slack, Discord, iMessage or a podcast's
 * show notes rendered as a bare URL. For a product whose secondary audience is
 * a book club on TikTok and YouTube, that is the whole of its distribution
 * arriving unbranded.
 *
 * Drawn rather than photographed: no font file to load, no image to fetch, so
 * it cannot fail at request time the way a remote asset can.
 */
export const alt =
  "Life on Books — every book you've read, and everywhere it took you";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#14110E";
const PAPER = "#FBF8F2";
const GOLD = "#D4A017";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: INK,
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <svg width="72" height="72" viewBox="0 0 64 64">
            <path
              d="M32 9c-9.4 0-17 7.4-17 16.6 0 12 17 29.4 17 29.4s17-17.4 17-29.4C49 16.4 41.4 9 32 9z"
              fill={GOLD}
            />
            <path d="M22.5 20.5h8.2v15h-8.2z" fill={INK} />
            <path d="M33.3 20.5h8.2v15h-8.2z" fill={INK} />
            <rect x="31" y="19" width="2" height="18" fill={GOLD} />
          </svg>
          <div
            style={{
              fontSize: 34,
              color: PAPER,
              letterSpacing: -0.5,
              fontWeight: 600,
            }}
          >
            Life on Books
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: 68,
              lineHeight: 1.1,
              color: PAPER,
              letterSpacing: -2,
              fontWeight: 700,
              maxWidth: 900,
            }}
          >
            Every book you&apos;ve read, and everywhere it took you.
          </div>
          <div style={{ fontSize: 30, color: GOLD, maxWidth: 880 }}>
            A reading tracker built around place.
          </div>
        </div>
      </div>
    ),
    size
  );
}
