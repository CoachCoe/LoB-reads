import { render, screen, fireEvent } from "@testing-library/react";
import StarRating from "@/components/ui/StarRating";

/**
 * UX-26. This component is the product's core input and it had no accessible
 * name, no role, no aria-checked and no keyboard model — five unlabelled
 * buttons, five of them disabled in the read-only case.
 *
 * These tests were rewritten with it. The property the old suite protected —
 * `rating` maps to exactly that many filled stars, which `const isFilled = true`
 * once satisfied entirely — is kept and extended to both forms. What is gone is
 * the assertions that pinned the old SHAPE: that read-only renders buttons, and
 * that they are disabled. A read-only rating is not five disabled buttons; it
 * is one image with one label, and asserting the old shape would forbid the fix.
 */

/** Stars painted with the brand token, in either form. */
const filledCount = (container: HTMLElement) =>
  [...container.querySelectorAll("svg")].filter((svg) =>
    svg.getAttribute("class")?.includes("fill-[var(--color-primary)]")
  ).length;

describe("StarRating, read-only", () => {
  it("is one labelled image, not a row of controls", () => {
    render(<StarRating rating={4} />);

    expect(screen.getByRole("img")).toHaveAccessibleName("Rated 4 out of 5");
    // The old form rendered five disabled buttons: five tab-stop-shaped things
    // announcing nothing.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("names what is being rated when told", () => {
    render(<StarRating rating={3} label="Dune" />);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Dune: rated 3 out of 5"
    );
  });

  it.each([0, 1, 3, 5])("fills exactly %i stars", (rating) => {
    const { container } = render(<StarRating rating={rating} />);
    expect(filledCount(container)).toBe(rating);
  });

  it("leaves the remainder unfilled rather than absent", () => {
    const { container } = render(<StarRating rating={2} />);
    expect(container.querySelectorAll("svg")).toHaveLength(5);
    expect(filledCount(container)).toBe(2);
  });

  it("honours maxRating", () => {
    const { container } = render(<StarRating rating={7} maxRating={10} />);
    expect(container.querySelectorAll("svg")).toHaveLength(10);
    expect(filledCount(container)).toBe(7);
    expect(screen.getByRole("img")).toHaveAccessibleName("Rated 7 out of 10");
  });

  it("ignores onChange, because it is not a control", () => {
    const handleChange = jest.fn();
    const { container } = render(<StarRating rating={0} onChange={handleChange} />);

    fireEvent.click(container.querySelectorAll("svg")[2]);

    expect(handleChange).not.toHaveBeenCalled();
  });
});

describe("StarRating, interactive", () => {
  const radios = () => screen.getAllByRole("radio");

  it("is a radio group whose options are named", () => {
    render(<StarRating rating={0} interactive onChange={() => {}} />);

    expect(screen.getByRole("radiogroup")).toHaveAccessibleName("Your rating");
    expect(radios()).toHaveLength(5);
    expect(radios().map((r) => r.getAttribute("aria-label"))).toEqual([
      "1 star",
      "2 stars",
      "3 stars",
      "4 stars",
      "5 stars",
    ]);
  });

  it("marks the current rating as the checked option", () => {
    render(<StarRating rating={3} interactive onChange={() => {}} />);
    expect(radios().map((r) => r.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "true",
      "false",
      "false",
    ]);
  });

  it("is one tab stop, not five", () => {
    render(<StarRating rating={3} interactive onChange={() => {}} />);
    expect(radios().filter((r) => r.getAttribute("tabindex") === "0")).toHaveLength(1);
    // And it is the checked one, so focus lands where the value is.
    expect(radios()[2]).toHaveAttribute("tabindex", "0");
  });

  it("puts the entry point on the first star when nothing is rated yet", () => {
    render(<StarRating rating={0} interactive onChange={() => {}} />);
    expect(radios()[0]).toHaveAttribute("tabindex", "0");
  });

  it("reports the star that was clicked", () => {
    const handleChange = jest.fn();
    render(<StarRating rating={0} interactive onChange={handleChange} />);

    fireEvent.click(radios()[2]);

    expect(handleChange).toHaveBeenCalledWith(3);
  });

  it.each([
    ["ArrowRight", 3, 4],
    ["ArrowUp", 3, 4],
    ["ArrowLeft", 3, 2],
    ["ArrowDown", 3, 2],
    ["Home", 3, 1],
    ["End", 3, 5],
  ])("sets the rating with %s", (key, from, expected) => {
    const handleChange = jest.fn();
    render(<StarRating rating={from} interactive onChange={handleChange} />);

    fireEvent.keyDown(screen.getByRole("radiogroup"), { key });

    expect(handleChange).toHaveBeenCalledWith(expected);
  });

  it.each([
    ["ArrowRight", 5, 5],
    ["ArrowLeft", 1, 1],
  ])("clamps %s at the end of the scale", (key, from, expected) => {
    const handleChange = jest.fn();
    render(<StarRating rating={from} interactive onChange={handleChange} />);

    fireEvent.keyDown(screen.getByRole("radiogroup"), { key });

    expect(handleChange).toHaveBeenCalledWith(expected);
  });

  it("previews the hovered rating without committing it", () => {
    const handleChange = jest.fn();
    const { container } = render(
      <StarRating rating={1} interactive onChange={handleChange} />
    );

    fireEvent.mouseEnter(radios()[3]);
    expect(filledCount(container)).toBe(4);
    expect(handleChange).not.toHaveBeenCalled();

    fireEvent.mouseLeave(screen.getByRole("radiogroup"));
    expect(filledCount(container)).toBe(1);
  });
});
