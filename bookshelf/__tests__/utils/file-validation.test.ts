/**
 * @jest-environment node
 *
 * Node rather than jsdom: jsdom's Blob does not implement `arrayBuffer()`, which
 * `validateImageFile` needs to read magic bytes. Nothing here touches the DOM.
 */
import {
  sanitizeFilename,
  validateImageFile,
  MAX_FILE_SIZE,
} from "@/lib/storage/file-validation";

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

/**
 * This describe block was empty, with a comment claiming File and ArrayBuffer
 * were too complex to mock. They are not: `File` and `Blob.arrayBuffer()` are
 * available in the Node runtime CI uses, and import-routes.test.ts already
 * constructs `new File([...])`.
 *
 * The gap mattered — the magic-byte check is the upload path's only content
 * control, reached from both the avatar and the fictional-world map route, and
 * neither route is covered either. Every branch below was previously untested.
 */
describe("validateImageFile", () => {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const JPEG = [0xff, 0xd8, 0xff];
  const GIF89a = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

  const fileOf = (bytes: number[], type: string, name = "x") =>
    new File([new Uint8Array(bytes)], name, { type });

  const pad = (bytes: number[], length = 16) => [
    ...bytes,
    ...new Array(Math.max(0, length - bytes.length)).fill(0),
  ];

  it("accepts a PNG whose bytes match its declared type", async () => {
    const result = await validateImageFile(fileOf(pad(PNG), "image/png"));
    expect(result.valid).toBe(true);
    expect(result.detectedType).toBe("image/png");
  });

  it.each([
    ["JPEG", JPEG, "image/jpeg"],
    ["GIF89a", GIF89a, "image/gif"],
  ])("accepts a valid %s", async (_label, bytes, type) => {
    expect((await validateImageFile(fileOf(pad(bytes), type))).valid).toBe(true);
  });

  it("rejects a type outside the allowlist", async () => {
    const result = await validateImageFile(fileOf(pad(PNG), "image/svg+xml"));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Invalid file type/);
  });

  it("rejects a file whose bytes contradict its declared type", async () => {
    // The whole point of the function: a JPEG, a PHP script or a PDF renamed
    // and relabelled as a PNG must not pass.
    const jpegAsPng = await validateImageFile(fileOf(pad(JPEG), "image/png"));
    expect(jpegAsPng.valid).toBe(false);
    expect(jpegAsPng.error).toMatch(/does not match declared type/);

    const php = [0x3c, 0x3f, 0x70, 0x68, 0x70]; // "<?php"
    expect((await validateImageFile(fileOf(pad(php), "image/png"))).valid).toBe(
      false
    );

    const pdf = [0x25, 0x50, 0x44, 0x46]; // "%PDF"
    expect((await validateImageFile(fileOf(pad(pdf), "image/jpeg"))).valid).toBe(
      false
    );
  });

  it("rejects a file truncated below the signature length", async () => {
    const result = await validateImageFile(fileOf([0x89, 0x50], "image/png"));
    expect(result.valid).toBe(false);
  });

  it("rejects a file over the size cap", async () => {
    const oversize = new File(
      [new Uint8Array(pad(PNG, MAX_FILE_SIZE + 1))],
      "big.png",
      { type: "image/png" }
    );
    const result = await validateImageFile(oversize);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too large/i);
  });

  it("requires the WEBP marker at offset 8, not just RIFF", async () => {
    const riff = [0x52, 0x49, 0x46, 0x46];
    const webp = [0x57, 0x45, 0x42, 0x50];

    const good = fileOf([...riff, 0, 0, 0, 0, ...webp], "image/webp");
    expect((await validateImageFile(good)).valid).toBe(true);

    // RIFF is also the container for WAV and AVI, so RIFF alone is not enough.
    const wav = fileOf(
      [...riff, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45],
      "image/webp"
    );
    const result = await validateImageFile(wav);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Invalid WebP/);
  });
});
