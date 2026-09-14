import type { MetadataRoute } from "next";

/**
 * Installable-app metadata.
 *
 * Small, and it is the difference between an icon on a phone home screen and a
 * screenshot of a browser tab. `theme-color` is what tints the status bar, so
 * the warm near-black here is the first brand surface a phone user sees.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Life on Books",
    short_name: "Life on Books",
    description:
      "A reading tracker built around place. Bring your Goodreads library, then watch your reading fill in the map.",
    start_url: "/",
    display: "standalone",
    background_color: "#14110E",
    theme_color: "#14110E",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/apple-icon.png", type: "image/png", sizes: "180x180" },
    ],
  };
}
