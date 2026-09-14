import { render, screen } from "@testing-library/react";
import ShelfSection from "@/app/(main)/my-books/ShelfSection";
import type { ShelfWithItems } from "@/server/shelves";

jest.mock("@/components/providers/ToastProvider", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

/**
 * SC-1: the route from /my-books to a shelf's own page.
 *
 * The condition was `bookCount > 6`, changed to
 * `bookCount > displayBooks.length` with a comment saying FLOW-15 fixed a
 * two-book shelf having no link. It did not: `displayBooks` is the first six of
 * `items`, and `items` is capped at SHELF_PREVIEW_SIZE, so
 * `displayBooks.length` is `min(bookCount, 6)` and the comparison is
 * `bookCount > 6` written differently.
 *
 * The sizes below are chosen around that boundary, because a test at only one
 * of them cannot tell the two conditions apart.
 */

const item = (n: number) => ({
  id: `item-${n}`,
  workKey: `/works/OLT${n}W`,
  addedAt: new Date(2026, 0, 1),
  work: {
    olKey: `/works/OLT${n}W`,
    title: `Book ${n}`,
    authorNames: "An Author",
    coverId: null,
    firstPublishYear: 2000,
    editionCount: 1,
  },
});

const shelf = (itemCount: number): ShelfWithItems => ({
  id: "shelf-1",
  name: "Want to Read",
  isDefault: true,
  userId: "user-1",
  itemCount,
  // The preview, capped the way getUserShelves caps it.
  items: Array.from({ length: Math.min(itemCount, 24) }, (_, i) => item(i)),
});

const viewAll = () => screen.queryByRole("link", { name: /view all/i });

describe("ShelfSection's link to the shelf page", () => {
  it.each([1, 2, 5, 6])(
    "links to the shelf page for a shelf of %i book(s)",
    (count) => {
      render(<ShelfSection shelf={shelf(count)} />);
      expect(viewAll()).toHaveAttribute("href", "/shelf/shelf-1");
    }
  );

  it("still links for a shelf larger than the preview", () => {
    render(<ShelfSection shelf={shelf(42)} />);
    expect(viewAll()).toHaveAttribute("href", "/shelf/shelf-1");
  });

  it("renders no link for an empty shelf, which has nothing to show", () => {
    render(<ShelfSection shelf={shelf(0)} />);
    expect(viewAll()).toBeNull();
  });

  it("shows the true total, not the capped preview length", () => {
    render(<ShelfSection shelf={shelf(42)} />);
    expect(screen.getByText("(42)")).toBeInTheDocument();
  });
});
