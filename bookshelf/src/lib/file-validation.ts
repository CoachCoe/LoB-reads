// Magic bytes for image file types
const IMAGE_SIGNATURES: { [key: string]: number[][] } = {
  "image/jpeg": [
    [0xff, 0xd8, 0xff],
  ],
  "image/png": [
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  ],
  "image/gif": [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  ],
  "image/webp": [
    [0x52, 0x49, 0x46, 0x46], // RIFF (WebP starts with RIFF)
  ],
};

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  detectedType?: string;
}

export const VALID_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Validate file by checking magic bytes against declared MIME type
 */
export async function validateImageFile(file: File): Promise<FileValidationResult> {
  // Check MIME type first
  if (!VALID_IMAGE_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: "Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image.",
    };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: "File too large. Maximum size is 5MB.",
    };
  }

  // Read first 12 bytes for magic byte validation
  const buffer = await file.slice(0, 12).arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Check if magic bytes match the declared MIME type
  const signatures = IMAGE_SIGNATURES[file.type];
  if (!signatures) {
    return {
      valid: false,
      error: "Unsupported image format.",
    };
  }

  const matchesSignature = signatures.some((signature) =>
    signature.every((byte, index) => bytes[index] === byte)
  );

  if (!matchesSignature) {
    return {
      valid: false,
      error: "File content does not match declared type. Please upload a valid image.",
    };
  }

  // For WebP, also check for WEBP marker at offset 8
  if (file.type === "image/webp") {
    const webpMarker = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
    const hasWebpMarker = webpMarker.every((byte, index) => bytes[8 + index] === byte);
    if (!hasWebpMarker) {
      return {
        valid: false,
        error: "Invalid WebP file.",
      };
    }
  }

  return { valid: true, detectedType: file.type };
}

/**
 * Sanitize filename to prevent path traversal and other issues
 */
export function sanitizeFilename(filename: string): string {
  // Remove path components
  const basename = filename.split(/[/\\]/).pop() || "file";

  // Remove special characters except dots, hyphens, and underscores
  const sanitized = basename.replace(/[^a-zA-Z0-9._-]/g, "_");

  // Limit length
  const maxLength = 100;
  if (sanitized.length > maxLength) {
    const ext = sanitized.split(".").pop() || "";
    const name = sanitized.slice(0, maxLength - ext.length - 1);
    return `${name}.${ext}`;
  }

  return sanitized;
}
