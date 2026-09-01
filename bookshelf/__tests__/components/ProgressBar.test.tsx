import { render, screen } from "@testing-library/react";
import ProgressBar from "@/components/ui/ProgressBar";

describe("ProgressBar component", () => {
  it("renders with correct percentage", () => {
    render(<ProgressBar value={50} max={100} />);
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("50 / 100 pages")).toBeInTheDocument();
  });

  it("calculates percentage correctly", () => {
    render(<ProgressBar value={25} max={200} />);
    expect(screen.getByText("13%")).toBeInTheDocument(); // 25/200 = 12.5% rounds to 13%
  });

  it("handles zero max value", () => {
    render(<ProgressBar value={50} max={0} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("handles 100% completion", () => {
    render(<ProgressBar value={300} max={300} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  /**
   * This assertion used to expect "150%", pinning the behaviour as correct.
   *
   * It is not correct, and it is how FLOW-28 survived: a work page showed
   * "310 / 162 pages - 191%" with a saturated bar, and the suite was green
   * because a test said 191% was fine. The root cause was a numerator and
   * denominator taken from different editions, fixed in
   * ReadingProgressSection; this clamp is the second line of defence, and it
   * matches what server/progress.ts percentOf has always done.
   *
   * Changed rather than deleted, and it still asserts something stronger than
   * before: the percentage is capped, and the raw counts are reported honestly
   * instead of being massaged to agree with it.
   */
  it("caps the percentage at 100 but still reports the real counts", () => {
    render(<ProgressBar value={150} max={100} />);

    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.queryByText("150%")).not.toBeInTheDocument();

    // The numbers are not rewritten to fit the cap — if they disagree, the
    // reader can still see that they disagree.
    expect(screen.getByText("150 / 100 pages")).toBeInTheDocument();
  });

  it("never renders a bar wider than its track", () => {
    const { container } = render(<ProgressBar value={310} max={162} />);
    const bar = container.querySelector("[style*='width']") as HTMLElement;

    // 191% overflowed the rounded track it sits in.
    expect(bar.style.width).toBe("100%");
  });

  it("does not render a negative width", () => {
    const { container } = render(<ProgressBar value={-20} max={100} />);
    const bar = container.querySelector("[style*='width']") as HTMLElement;

    expect(bar.style.width).toBe("0%");
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("hides label when showLabel is false", () => {
    render(<ProgressBar value={50} max={100} showLabel={false} />);
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
    expect(screen.queryByText("50 / 100 pages")).not.toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <ProgressBar value={50} max={100} className="custom-class" />
    );
    expect(container.firstChild).toHaveClass("custom-class");
  });
});

/**
 * The label text was covered thoroughly; the bar itself was not. Hardcoding
 * `style={{ width: "100%" }}` passed every existing test, and every reader
 * would have appeared to finish every book.
 */
describe("ProgressBar bar width", () => {
  const barWidth = (container: HTMLElement) =>
    (container.querySelector("[style*='width']") as HTMLElement | null)?.style
      .width;

  it.each([
    [0, 100, "0%"],
    [50, 100, "50%"],
    [100, 100, "100%"],
    [1, 8, "13%"],
  ])("renders %i/%i as %s", (value, max, expected) => {
    const { container } = render(<ProgressBar value={value} max={max} />);
    expect(barWidth(container)).toBe(expected);
  });
});

/**
 * FLOW-7. The label is hardcoded "{value} / {max} pages", so a caller passing a
 * percentage against 100 rendered "15 / 100 pages" — directly above the home
 * card's own, correct "page 47 of 320 · 15%". Two denominators for one book, one
 * of them 100.
 *
 * The bar is not wrong to be percentage-shaped; the label is wrong to assume
 * pages. Asserted here so the next caller that wants a bare bar has an obvious
 * way to ask for one.
 */
describe("ProgressBar without a label", () => {
  it("renders no text at all when showLabel is false", () => {
    const { container } = render(
      <ProgressBar value={15} max={100} showLabel={false} />
    );

    expect(container.textContent).toBe("");
    // The bar itself is still there and still sized.
    expect(
      (container.querySelector("[style*='width']") as HTMLElement).style.width
    ).toBe("15%");
  });
});
