import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site";

/**
 * Crawl policy.
 *
 * The product's largest asset is several million public, server-rendered work
 * and author pages, and until now there was no sitemap, no robots policy and no
 * canonical strategy — so none of it ranked.
 *
 * The disallows are the pages that are either private, per-reader, or an
 * infinite crawl surface. `/search` in particular: it takes an arbitrary `q`,
 * so a crawler can generate unbounded distinct URLs from it, each one running
 * the search path. `/work/*` and `/author/*` are the pages worth indexing and
 * they are reachable from the sitemap without it.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/search",
        "/settings",
        "/my-books",
        "/feed",
        "/wrapped",
        "/import/",
        "/login",
        "/register",
      ],
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
