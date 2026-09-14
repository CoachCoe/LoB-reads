/**
 * @jest-environment node
 */
import robots from "@/app/robots";

/**
 * UX-25. The product's largest asset is several million public,
 * server-rendered work and author pages, and there was no robots policy, no
 * sitemap and no canonical strategy — so none of it was indexable.
 *
 * The risk now is the opposite one: a disallow rule that quietly grows to cover
 * a page the product wants found. `conventions.test.ts` pins the list of pages
 * that must stay publicly reachable; this pins that the crawl policy agrees
 * with it, because the two can drift apart silently.
 */
describe("the crawl policy", () => {
  const rules = () => {
    const { rules: r } = robots();
    // One rule object, not an array — asserted so this test fails loudly rather
    // than silently passing if the shape changes.
    expect(Array.isArray(r)).toBe(false);
    const single = r as { allow?: string | string[]; disallow?: string | string[] };
    return {
      disallow: ([] as string[]).concat(single.disallow ?? []),
      allow: ([] as string[]).concat(single.allow ?? []),
    };
  };

  /** Whether `path` is blocked by any disallow prefix. */
  const blocked = (path: string) =>
    rules().disallow.some((prefix) => path.startsWith(prefix));

  it.each([
    ["/", "the landing page"],
    ["/about", "what the product is"],
    ["/map", "the differentiator"],
    ["/work/OL45804W", "a work page — several million of these"],
    ["/author/Ursula%20K.%20Le%20Guin", "an author page"],
    ["/shelf/abc123", "a public shelf"],
    ["/user/abc123", "a public profile"],
  ])("leaves %s crawlable (%s)", (path) => {
    expect(blocked(path)).toBe(false);
  });

  it.each([
    ["/api/shelves", "an API route"],
    ["/settings", "a reader's own settings"],
    ["/my-books", "a reader's own library"],
    ["/feed", "a reader's own feed"],
    ["/wrapped", "a reader's own year"],
    ["/import/abc123", "a reader's raw reading history"],
  ])("keeps %s out of the index (%s)", (path) => {
    expect(blocked(path)).toBe(true);
  });

  it("keeps /search out, because its query string is an unbounded URL space", () => {
    // A crawler can generate distinct /search?q=… URLs without limit, each one
    // running the search path — up to the fuzzy arm's budget. The work and
    // author pages are what is worth indexing and the sitemap reaches them
    // without this one.
    expect(blocked("/search")).toBe(true);
  });

  it("points at a sitemap", () => {
    expect(robots().sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
