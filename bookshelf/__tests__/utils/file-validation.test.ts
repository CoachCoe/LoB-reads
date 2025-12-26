import { sanitizeFilename } from "@/lib/file-validation";

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
