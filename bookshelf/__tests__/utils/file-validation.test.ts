import { sanitizeFilename } from "@/lib/storage/file-validation";

describe("sanitizeFilename", () => {
  it("should keep simple filenames unchanged", () => {
    expect(sanitizeFilename("image.png")).toBe("image.png");
    expect(sanitizeFilename("my-file_123.jpg")).toBe("my-file_123.jpg");
  });

  it("should remove path traversal characters", () => {
    expect(sanitizeFilename("../../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\windows\\system.ini")).toBe("system.ini");
  });

  it("should remove special characters", () => {
    expect(sanitizeFilename("file<script>.png")).toBe("file_script_.png");
    expect(sanitizeFilename("file'name\".jpg")).toBe("file_name_.jpg");
    expect(sanitizeFilename("file name.png")).toBe("file_name.png");
  });

  it("should handle empty or invalid input", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("/")).toBe("file");
  });

  it("should truncate long filenames", () => {
    const longName = "a".repeat(150) + ".png";
    const result = sanitizeFilename(longName);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.endsWith(".png")).toBe(true);
  });

  // The case above is the one shape where the old implementation worked:
  // ext = "png", so `slice(0, 100 - 3 - 1)` happened to land on 96. These are
  // the inputs that discriminate. Without a dot, `split(".").pop()` returned
  // the whole string as the "extension", the slice length went negative, and
  // the result came back LONGER than the input — 249 characters, as a blob key.
  it.each([
    ["no extension at all", "a".repeat(150)],
    ["an extension longer than the cap", "c".repeat(20) + "." + "e".repeat(130)],
    ["a leading dot and no real extension", "." + "a".repeat(150)],
    ["a dot as the very last character", "d".repeat(150) + "."],
  ])("caps the length with %s", (_label, input) => {
    const result = sanitizeFilename(input);
    expect(result.length).toBeLessThanOrEqual(100);
    // Never longer than what it was given, which is what actually broke.
    expect(result.length).toBeLessThanOrEqual(input.length);
    expect(result).not.toContain("/");
  });

  it("should handle unicode characters", () => {
    expect(sanitizeFilename("файл.png")).toBe("____.png");
    expect(sanitizeFilename("图片.jpg")).toBe("__.jpg");
  });
});

describe("validateImageFile", () => {
  // Note: Full magic byte validation tests would require mocking File and ArrayBuffer
  // which is complex in Node.js test environment. The sanitizeFilename tests above
  // cover the synchronous utility function.
});
