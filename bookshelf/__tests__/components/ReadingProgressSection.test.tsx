import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ReadingProgressSection from "@/components/catalog/ReadingProgressSection";

/**
 * FLOW-28: the progress bar divided one book by another.
 *
 * A real work page rendered **"310 / 162 pages — 191%"** with a saturated bar.
 * The numerator was the reading session's `currentPage`; the denominator was
 * the `pageCount` prop, which the work page fills from whichever edition states
 * a count first — by a line whose own comment concedes "Editions disagree about
 * page counts".
 *
 * The session carries its own `pageCount` snapshot, deliberately frozen so
 * history survives a catalog rebuild, and it is what the write path validates
 * `currentPage` against (server/progress.ts:167). So a reader on a 480-page
 * edition can legitimately reach page 310 — the server accepts it — and then be
 * shown 191% of a different edition's 162 pages. The snapshot was already in
 * the payload this component fetches. It was simply not being read.
 *
 * Three things had to move together, which is why they are asserted together:
 * the bar's denominator, the label, and the number input's ceiling. The input
 * mattered independently — its `max` was the wrong edition's count, so the form
 * would block a page the server accepts and offer pages it rejects.
 */

const showToast = jest.fn();
jest.mock("@/components/providers/ToastProvider", () => ({
  useToast: () => ({ showToast }),
}));

jest.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "u1", name: "A Reader" } },
    status: "authenticated",
  }),
}));

/** The `/api/progress?workKey=…` response for one work. */
function respondWith(progress: unknown) {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(progress) })
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ReadingProgressSection page counts", () => {
  it("measures progress against the session's own edition, not another's", async () => {
    // The session the reader actually started: a 480-page edition, page 310.
    respondWith({
      workKey: "OL1W",
      currentPage: 310,
      pageCount: 480,
      finishedAt: null,
    });

    // The work page offers 162, from a different edition entirely.
    render(<ReadingProgressSection workKey="OL1W" pageCount={162} />);

    await waitFor(() =>
      expect(screen.getByText("310 / 480 pages")).toBeInTheDocument()
    );

    // 310/480 = 64.6%. The bug rendered 191%.
    expect(screen.getByText("65%")).toBeInTheDocument();
    expect(screen.queryByText("191%")).not.toBeInTheDocument();
    expect(screen.queryByText("310 / 162 pages")).not.toBeInTheDocument();
  });

  it("keeps the bar within its track", async () => {
    respondWith({
      workKey: "OL1W",
      currentPage: 310,
      pageCount: 480,
      finishedAt: null,
    });

    const { container } = render(
      <ReadingProgressSection workKey="OL1W" pageCount={162} />
    );

    await waitFor(() =>
      expect(screen.getByText("310 / 480 pages")).toBeInTheDocument()
    );
    const bar = container.querySelector("[style*='width']") as HTMLElement;
    expect(bar.style.width).toBe("65%");
  });

  it("offers the ceiling the server will actually accept", async () => {
    respondWith({
      workKey: "OL1W",
      currentPage: 310,
      pageCount: 480,
      finishedAt: null,
    });

    render(<ReadingProgressSection workKey="OL1W" pageCount={162} />);
    await waitFor(() =>
      expect(screen.getByText("310 / 480 pages")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "Update Progress" }));

    // The server validates against 480. A max of 162 would refuse page 300,
    // which is a page the reader has genuinely reached.
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("max", "480");
  });

  it("falls back to the work's page count when the session recorded none", async () => {
    // pageCount is nullable on the session, and an older row may not have one.
    respondWith({
      workKey: "OL1W",
      currentPage: 80,
      pageCount: null,
      finishedAt: null,
    });

    render(<ReadingProgressSection workKey="OL1W" pageCount={162} />);

    await waitFor(() =>
      expect(screen.getByText("80 / 162 pages")).toBeInTheDocument()
    );
    expect(screen.getByText("49%")).toBeInTheDocument();
  });

  it("tracks the page number with no denominator anywhere", async () => {
    respondWith({
      workKey: "OL1W",
      currentPage: 80,
      pageCount: null,
      finishedAt: null,
    });

    render(<ReadingProgressSection workKey="OL1W" pageCount={null} />);

    // Better than refusing to track, per the work page's own comment: the bar
    // is omitted and the page number still counts.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Update Progress" })
      ).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: "Update Progress" }));
    expect(screen.getByText("/ ? pages")).toBeInTheDocument();
  });
});
