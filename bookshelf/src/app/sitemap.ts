import type { MetadataRoute } from "next";
import { getSitemapWorkKeys } from "@/server/catalog";
import { SITE_ORIGIN } from "./layout";

/**
 * The public surface, for crawlers.
 *
 * **Bounded, and the bound is a decision rather than an oversight.** The
 * catalog holds 6.9M works. A sitemap file may carry 50,000 URLs, so indexing
 * all of them means ~139 sharded files via `generateSitemaps`, and that is a
 * crawl-budget and database-load decision rather than an audit's call — filed
 * as an open question. What is here is the head of the distribution by edition
 * count, which is where the search demand actually is, and it is 25,000 URLs
 * more than the zero that existed before.
 *
 * `/search` is deliberately absent and disallowed in robots.ts: it takes an
 * arbitrary `q`, so listing it invites unbounded distinct URLs each running the
 * search path.
 */
const WORKS_IN_SITEMAP = 25_000;

/** Rebuilt daily. The catalog itself is rebuilt monthly. */
export const revalidate = 86_400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_ORIGIN, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_ORIGIN}/map`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_ORIGIN}/about`, changeFrequency: "monthly", priority: 0.5 },
  ];

  let workRoutes: MetadataRoute.Sitemap = [];
  try {
    const keys = await getSitemapWorkKeys(WORKS_IN_SITEMAP);
    workRoutes = keys.map((olKey) => ({
      // olKey is stored as "/works/OL123W"; the route is /work/OL123W.
      url: `${SITE_ORIGIN}/work/${encodeURIComponent(olKey.replace(/^\/works\//, ""))}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    }));
  } catch {
    // A sitemap that 500s is worse than a short one: a crawler treats the
    // error as the answer. An empty catalog is also the normal state of a
    // fresh checkout, which is when this is most likely to be hit.
  }

  return [...staticRoutes, ...workRoutes];
}
