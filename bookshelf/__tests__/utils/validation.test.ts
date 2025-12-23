// Tests for validation patterns used in the codebase
describe("Email validation", () => {
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  it("accepts valid email addresses", () => {
    expect(EMAIL_REGEX.test("user@example.com")).toBe(true);
    expect(EMAIL_REGEX.test("user.name@example.com")).toBe(true);
    expect(EMAIL_REGEX.test("user+tag@example.com")).toBe(true);
    expect(EMAIL_REGEX.test("user@subdomain.example.com")).toBe(true);
  });

  it("rejects invalid email addresses", () => {
    expect(EMAIL_REGEX.test("")).toBe(false);
    expect(EMAIL_REGEX.test("user")).toBe(false);
    expect(EMAIL_REGEX.test("user@")).toBe(false);
    expect(EMAIL_REGEX.test("@example.com")).toBe(false);
    expect(EMAIL_REGEX.test("user @example.com")).toBe(false);
    expect(EMAIL_REGEX.test("user@example")).toBe(false);
  });
});

describe("Password validation", () => {
  function isValidPassword(password: string): boolean {
    return password.length >= 6;
  }

  it("accepts passwords with 6+ characters", () => {
    expect(isValidPassword("123456")).toBe(true);
    expect(isValidPassword("password")).toBe(true);
    expect(isValidPassword("verylongpassword123")).toBe(true);
  });

  it("rejects passwords shorter than 6 characters", () => {
    expect(isValidPassword("")).toBe(false);
    expect(isValidPassword("12345")).toBe(false);
    expect(isValidPassword("a")).toBe(false);
  });
});

describe("Name validation", () => {
  function isValidName(name: string): boolean {
    return name.trim().length >= 2;
  }

  it("accepts names with 2+ characters", () => {
    expect(isValidName("Jo")).toBe(true);
    expect(isValidName("John")).toBe(true);
    expect(isValidName("John Doe")).toBe(true);
  });

  it("rejects names shorter than 2 characters", () => {
    expect(isValidName("")).toBe(false);
    expect(isValidName("A")).toBe(false);
    expect(isValidName("   ")).toBe(false);
    expect(isValidName(" B ")).toBe(false);
  });
});

describe("Rating validation", () => {
  function isValidRating(rating: number): boolean {
    return rating >= 1 && rating <= 5 && Number.isInteger(rating);
  }

  it("accepts valid ratings 1-5", () => {
    expect(isValidRating(1)).toBe(true);
    expect(isValidRating(2)).toBe(true);
    expect(isValidRating(3)).toBe(true);
    expect(isValidRating(4)).toBe(true);
    expect(isValidRating(5)).toBe(true);
  });

  it("rejects ratings outside 1-5", () => {
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(-1)).toBe(false);
  });

  it("rejects non-integer ratings", () => {
    expect(isValidRating(3.5)).toBe(false);
    expect(isValidRating(4.9)).toBe(false);
  });
});
