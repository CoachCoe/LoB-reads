import { render, screen } from "@testing-library/react";
import ProjectionsView from "@/app/(main)/wrapped/projections/ProjectionsView";
import type { WrappedProjections } from "@/server/wrapped";

/**
 * TEST-20: the year-progress bar computed its own percentage instead of going
 * through ProgressBar, and got two things wrong doing it.
 *
 * `(daysElapsed / 365) * 100` hardcoded the year length, so 31 December of a
 * leap year is day 366 and reported 100.27% — written straight into a CSS
 * width, with nothing clamping it. The real length is already on the payload
 * as `daysElapsed + daysRemaining`.
 */
const projections = (over: Partial<WrappedProjections> = {}): WrappedProjections => ({
  year: 2026,
  booksReadYTD: 10,
  pagesReadYTD: 1830,
  reviewsWrittenYTD: 4,
  daysElapsed: 183,
  daysRemaining: 182,
  booksPerMonth: 1.7,
  pagesPerDay: 10,
  projectedBooksEndOfYear: 20,
  projectedPagesEndOfYear: 3650,
  booksNeededPerMonthFor50: 6.7,
  booksNeededPerMonthFor100: 15.1,
  onTrackFor50: false,
  onTrackFor100: false,
  previousYearBooks: null,
  aheadOfLastYear: null,
  readingByMonth: Array.from({ length: 12 }, (_, month) => ({ month, count: 0 })),
  lastBookFinished: null,
  currentlyReading: [],
  ...over,
});

/**
 * The year-progress bar is the only element whose width is a percentage.
 *
 * Returned as a number rather than the style string: the exact text is a
 * float artefact (183/365 is "50.136986301369866%"), and pinning that spelling
 * asserts JavaScript's formatting rather than this component's arithmetic.
 */
function yearBarWidth(container: HTMLElement): number {
  const bar = Array.from(container.querySelectorAll<HTMLElement>("[style]")).find(
    (el) => /^width:/.test(el.getAttribute("style") ?? "")
  );
  return Number.parseFloat(bar!.style.width);
}

describe("ProjectionsView year-progress bar", () => {
  it("renders the fraction of the year elapsed", () => {
    // 183 of 365 days.
    const { container } = render(
      <ProjectionsView projections={projections()} userName="Reader" />
    );
    expect(yearBarWidth(container)).toBeCloseTo(50.137, 3);
  });

  it("uses the real length of a leap year, not a hardcoded 365", () => {
    // 2024: 366 days. Day 183 is a smaller fraction of it than of 365, and a
    // denominator of 365 would give 50.13% here too.
    const { container } = render(
      <ProjectionsView
        projections={projections({ year: 2024, daysElapsed: 183, daysRemaining: 183 })}
        userName="Reader"
      />
    );
    // A denominator of 365 would give 50.137 here, so three decimals is
    // enough to tell the two apart.
    expect(yearBarWidth(container)).toBeCloseTo(50, 3);
  });

  it("never renders a width past 100% on the last day of a leap year", () => {
    // 31 December 2024 is day 366 with none remaining. Against a hardcoded
    // 365 this was 100.27%, which is what the clamp is for.
    const { container } = render(
      <ProjectionsView
        projections={projections({ year: 2024, daysElapsed: 366, daysRemaining: 0 })}
        userName="Reader"
      />
    );
    expect(yearBarWidth(container)).toBe(100);
  });

  it("still renders on 1 January, when almost nothing has elapsed", () => {
    const { container } = render(
      <ProjectionsView
        projections={projections({ daysElapsed: 1, daysRemaining: 364 })}
        userName="Reader"
      />
    );
    expect(yearBarWidth(container)).toBeCloseTo(0.274, 3);
    expect(screen.getByText(/364/)).toBeInTheDocument();
  });
});
