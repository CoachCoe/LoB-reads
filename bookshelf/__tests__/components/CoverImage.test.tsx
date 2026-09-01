import { render, screen } from "@testing-library/react";
import CoverImage from "@/components/catalog/CoverImage";
import { coverUrl } from "@/lib/covers";

/**
 * Covers are hotlinked from Open Library and a good number are not there.
 *
 * The subtlety worth a test: Open Library answers a cover id it has no image for
 * with **200 and a 43-byte blank placeholder**, not a 404. So `onError` never
 * fires and every fallback in the app is unreachable — the reader sees a blank
 * tile and the code believes it succeeded. `default=false` turns that into a
 * real 404, which is the only reason the fallback below can ever run.
 */
describe("coverUrl", () => {
  it("asks Open Library not to substitute a placeholder", () => {
    // Without this parameter the fallback is dead code.
    expect(coverUrl(12345)).toContain("default=false");
  });

  it("returns null when there is no cover id at all", () => {
    expect(coverUrl(null)).toBeNull();
    expect(coverUrl(undefined)).toBeNull();
    expect(coverUrl(0)).toBeNull();
  });

  it("prefers a stored URL, untouched", () => {
    const stored = "https://cdn.example.invalid/covers/M/1.jpg";
    expect(coverUrl(12345, "M", stored)).toBe(stored);
  });

  it("requests the large size for a large slot", () => {
    expect(coverUrl(12345, "L")).toContain("-L.jpg");
  });
});

describe("CoverImage", () => {
  it("typesets the title when there is no cover", () => {
    render(<CoverImage title="Wuthering Heights" olKey="OL1W" coverId={null} />);

    // The title, not a generic glyph: six identical book icons in a row tell
    // the reader nothing about which book is which.
    expect(screen.getByText("Wuthering Heights")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders an image when there is one", () => {
    render(<CoverImage title="Dune" olKey="OL2W" coverId={12345} />);

    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toContain("12345");
  });

  it("gives a work the same cloth colour every time", () => {
    // Otherwise a cover changes colour between renders of the same grid.
    const first = render(
      <CoverImage title="A" olKey="OL42W" coverId={null} />
    ).container.firstElementChild as HTMLElement;
    const firstColour = first.style.backgroundColor;

    const second = render(
      <CoverImage title="A" olKey="OL42W" coverId={null} />
    ).container.firstElementChild as HTMLElement;

    expect(firstColour).not.toBe("");
    expect(second.style.backgroundColor).toBe(firstColour);
  });

  it("gives different works different cloth", () => {
    const colourFor = (olKey: string) =>
      (
        render(<CoverImage title="t" olKey={olKey} coverId={null} />).container
          .firstElementChild as HTMLElement
      ).style.backgroundColor;

    // Five cloths, so collisions are expected — but not every key alike.
    const colours = new Set(
      ["OL1W", "OL2W", "OL3W", "OL4W", "OL5W", "OL6W", "OL7W", "OL8W"].map(
        colourFor
      )
    );
    expect(colours.size).toBeGreaterThan(1);
  });

  it("omits the title at thumbnail size, where it would be illegible", () => {
    render(
      <CoverImage title="Wuthering Heights" olKey="OL1W" coverId={null} size="xs" />
    );
    expect(screen.queryByText("Wuthering Heights")).toBeNull();
  });

  it("labels a large slot as having no cover", () => {
    render(
      <CoverImage title="Wuthering Heights" olKey="OL1W" coverId={null} size="lg" />
    );
    // So a typeset fallback is not mistaken for the real jacket.
    expect(screen.getByText(/no cover/i)).toBeInTheDocument();
  });
});
