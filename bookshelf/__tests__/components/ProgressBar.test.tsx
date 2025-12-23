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

  it("handles over 100% (value > max)", () => {
    render(<ProgressBar value={150} max={100} />);
    expect(screen.getByText("150%")).toBeInTheDocument();
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
