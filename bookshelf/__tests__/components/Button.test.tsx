import { render, screen, fireEvent } from "@testing-library/react";
import Button from "@/components/ui/Button";

describe("Button component", () => {
  it("renders children correctly", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button")).toHaveTextContent("Click me");
  });

  it("handles click events", () => {
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Click me</Button>);

    fireEvent.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("shows loading spinner when isLoading is true", () => {
    render(<Button isLoading>Loading</Button>);

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button.querySelector("svg")).toBeInTheDocument();
  });

  it("is disabled when disabled prop is true", () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  /**
   * TQ-23. This asserted the gold hex as a literal class while contrast.test.ts
   * pinned the ratio of `--color-primary` — so the test was actively holding
   * the two apart, and a change to the token could not reach the button. It
   * asserts the token now, which is what the component uses.
   *
   * Three variants also had no test at all, and `success` is byte-identical to
   * `primary`; both are recorded here rather than left implied.
   */
  it("paints the primary variant from the brand token, not a literal", () => {
    render(<Button variant="primary">Primary</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-[var(--color-primary)]");
  });

  it("gives a gold fill a dark label, never white", () => {
    // 2.38:1. A gold button whose own label could not be read — the defect
    // --color-primary-contrast exists for.
    render(<Button variant="primary">Primary</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("text-[var(--color-primary-contrast)]");
    expect(button).not.toHaveClass("text-white");
  });

  it.each([
    ["primary", "bg-[var(--color-primary)]"],
    ["success", "bg-[var(--color-primary)]"],
    ["outline", "border-[var(--color-primary)]"],
    ["danger", "bg-red-600"],
    ["secondary", "bg-gray-100"],
    ["ghost", "bg-transparent"],
  ] as const)("applies the %s variant", (variant, expected) => {
    render(<Button variant={variant}>Label</Button>);
    expect(screen.getByRole("button")).toHaveClass(expected);
  });

  it("applies size styles correctly", () => {
    const { rerender } = render(<Button size="sm">Small</Button>);
    let button = screen.getByRole("button");
    expect(button).toHaveClass("px-4", "py-2");

    rerender(<Button size="lg">Large</Button>);
    button = screen.getByRole("button");
    expect(button).toHaveClass("px-8", "py-3");
  });
});
