/**
 * @jest-environment node
 */
import { readFileSync } from "node:fs";

/**
 * Colour contrast, computed from the tokens rather than trusted.
 *
 * STATUS.md recorded that nothing visual had ever been checked — "the dark-mode
 * sweep was verified by grep and a build, not by looking" — and a design review
 * then found three live WCAG failures in the token set:
 *
 *   --foreground-secondary #86868b on #fafafa   3.47:1  (needs 4.5)
 *   --color-primary #D4A017 used as text        2.28:1  (needs 4.5)
 *   white label on a #D4A017 button fill        2.38:1  (needs 4.5)
 *
 * A number in a stylesheet is exactly the kind of thing that gets reverted by
 * someone who thinks it looks better, so the ratios are asserted here instead of
 * being written down in a document.
 */

const CSS = readFileSync("src/app/globals.css", "utf8");

/** The value of a token, from `:root` or from `.dark`. */
function token(name: string, scope: "light" | "dark"): string {
  // `.dark` follows `:root` in the file, so the dark block is everything after
  // it and the light block is everything before.
  const darkAt = CSS.indexOf(".dark {");
  expect(darkAt).toBeGreaterThan(-1);

  const block = scope === "light" ? CSS.slice(0, darkAt) : CSS.slice(darkAt);
  const match = block.match(
    new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`)
  );

  if (!match) {
    throw new Error(`token --${name} not found in the ${scope} block`);
  }
  return match[1];
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x relative contrast, 1:1 to 21:1. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA_TEXT = 4.5;

describe("contrast of the colour tokens", () => {
  it("computes a known ratio correctly", () => {
    // Black on white is 21:1 exactly; if this drifts the helper is wrong and
    // every assertion below is meaningless.
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  describe("light", () => {
    it("secondary text meets AA on the page background", () => {
      const ratio = contrast(
        token("foreground-secondary", "light"),
        token("background", "light")
      );
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("secondary text meets AA on a card", () => {
      const ratio = contrast(
        token("foreground-secondary", "light"),
        token("card-bg", "light")
      );
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("gold-as-text meets AA — the accent fill never may", () => {
      expect(
        contrast(token("color-primary-text", "light"), token("background", "light"))
      ).toBeGreaterThanOrEqual(AA_TEXT);

      // The reason the separate token exists. Pinned so nobody "simplifies"
      // --color-primary-text back to --color-primary.
      expect(
        contrast(token("color-primary", "light"), token("background", "light"))
      ).toBeLessThan(AA_TEXT);
    });

    it("a label on a gold fill meets AA", () => {
      const ratio = contrast(
        token("color-primary-contrast", "light"),
        token("color-primary", "light")
      );
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("the focus ring is clearly visible against the page", () => {
      // 3:1 is the non-text threshold for a focus indicator.
      expect(
        contrast(token("focus-ring", "light"), token("background", "light"))
      ).toBeGreaterThanOrEqual(3);
    });
  });

  describe("dark", () => {
    it("body and secondary text meet AA on a card", () => {
      expect(
        contrast(token("foreground", "dark"), token("card-bg", "dark"))
      ).toBeGreaterThanOrEqual(AA_TEXT);
      expect(
        contrast(token("foreground-secondary", "dark"), token("card-bg", "dark"))
      ).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("gold-as-text meets AA", () => {
      expect(
        contrast(token("color-primary-text", "dark"), token("card-bg", "dark"))
      ).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("the focus ring is clearly visible against the page", () => {
      expect(
        contrast(token("focus-ring", "dark"), token("background", "dark"))
      ).toBeGreaterThanOrEqual(3);
    });

    it("a card is distinguishable from the page by BOTH surface and border", () => {
      const page = token("background", "dark");
      const card = token("card-bg", "dark");
      const border = token("card-border", "dark");

      // The bug this replaces: card and page were the same colour — 1.00:1 —
      // leaving the border as the only cue that anything was grouped.
      expect(card).not.toBe(page);
      expect(contrast(card, page)).toBeGreaterThan(1.05);

      // And the border must be a step above the card, not below it.
      expect(luminance(border)).toBeGreaterThan(luminance(card));

      // Deliberately not asserting 3:1. Contrast ratios compress at the dark
      // end: no pair of near-blacks can reach it, so demanding 3:1 here would
      // mean lifting the whole page off #0a0a0a — a design decision, not a
      // defect fix. What is asserted is that two cues exist and point the right
      // way.
    });
  });
});
