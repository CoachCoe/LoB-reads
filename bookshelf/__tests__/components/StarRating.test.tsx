import { render, screen, fireEvent } from "@testing-library/react";
import StarRating from "@/components/ui/StarRating";

describe("StarRating component", () => {
  it("renders correct number of stars", () => {
    render(<StarRating rating={3} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(5); // default maxRating is 5
  });

  it("renders custom number of stars when maxRating is set", () => {
    render(<StarRating rating={3} maxRating={10} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(10);
  });

  it("calls onChange when interactive and clicked", () => {
    const handleChange = jest.fn();
    render(<StarRating rating={0} interactive onChange={handleChange} />);

    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[2]); // Click the 3rd star

    expect(handleChange).toHaveBeenCalledWith(3);
  });

  it("does not call onChange when not interactive", () => {
    const handleChange = jest.fn();
    render(<StarRating rating={0} onChange={handleChange} />);

    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[2]);

    expect(handleChange).not.toHaveBeenCalled();
  });

  it("disables buttons when not interactive", () => {
    render(<StarRating rating={3} />);
    const buttons = screen.getAllByRole("button");

    buttons.forEach((button) => {
      expect(button).toBeDisabled();
    });
  });

  it("enables buttons when interactive", () => {
    render(<StarRating rating={3} interactive onChange={() => {}} />);
    const buttons = screen.getAllByRole("button");

    buttons.forEach((button) => {
      expect(button).not.toBeDisabled();
    });
  });
});
