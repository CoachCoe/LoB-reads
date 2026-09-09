import { getSafeCallbackUrl } from "@/lib/http/callback-url";

/**
 * JR-19 and JB-13. Two things are being pinned here.
 *
 * The redirect must stay closed — this is the check that stops
 * `?callbackUrl=https://evil.example` sending a reader off-site after they
 * sign in.
 *
 * And it must stop rejecting ordinary paths. The previous rule refused any URL
 * containing a colon, so `/search?q=dune:messiah` silently became `/`. Nothing
 * generates such a URL today, which is why it was latent; the navbar now
 * builds callbacks from the current pathname, so it stops being hypothetical.
 */

describe("getSafeCallbackUrl", () => {
  it.each([
    ["/", "/"],
    ["/work/OL1W", "/work/OL1W"],
    ["/my-books", "/my-books"],
    ["/search?q=dune", "/search?q=dune"],
    // The case the old rule broke.
    ["/search?q=dune:messiah", "/search?q=dune:messiah"],
    ["/work/OL1W#reviews", "/work/OL1W#reviews"],
    ["/author/100%25%20Jesus%20Books", "/author/100%25%20Jesus%20Books"],
  ])("keeps %s", (input, expected) => {
    expect(getSafeCallbackUrl(input)).toBe(expected);
  });

  it.each([
    ["https://evil.example/phish", "an absolute URL"],
    ["http://evil.example", "another absolute URL"],
    ["//evil.example", "protocol-relative"],
    ["/\\evil.example", "backslash protocol-relative"],
    ["javascript:alert(1)", "a javascript: URL"],
    ["JavaScript:alert(1)", "a javascript: URL, cased differently"],
    ["data:text/html,<script>", "a data: URL"],
    ["work/OL1W", "a path that does not start with a slash"],
    ["", "empty"],
  ])("refuses %s (%s) and falls back to /", (input) => {
    expect(getSafeCallbackUrl(input)).toBe("/");
  });

  it("refuses null and undefined", () => {
    expect(getSafeCallbackUrl(null)).toBe("/");
    expect(getSafeCallbackUrl(undefined)).toBe("/");
  });

  it("never returns anything that is not a path", () => {
    // The property, rather than a list: whatever comes back is safe to hand to
    // router.push, so it must always begin with a single slash.
    const inputs = [
      "https://evil.example",
      "//evil.example",
      "javascript:alert(1)",
      "/ok",
      "/ok?q=a:b",
      null,
    ];
    for (const input of inputs) {
      const result = getSafeCallbackUrl(input);
      expect(result.startsWith("/")).toBe(true);
      expect(result.startsWith("//")).toBe(false);
    }
  });
});
