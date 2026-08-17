import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

/**
 * Object storage for user uploads (avatars, fictional-world maps).
 *
 * Routes talk to this module, not to a vendor SDK, so replacing the backend is
 * a change to this file alone. Objects live in a private S3 bucket and are
 * served through CloudFront — the bucket itself is never public.
 */

const BUCKET = process.env.S3_BUCKET;
const REGION = process.env.AWS_REGION ?? "us-east-1";

/**
 * Public base URL uploads are served from — the CloudFront distribution
 * domain. Falls back to the bucket's regional endpoint so local development
 * works without a CDN in front.
 */
const PUBLIC_BASE_URL =
  process.env.CDN_URL?.replace(/\/$/, "") ??
  (BUCKET ? `https://${BUCKET}.s3.${REGION}.amazonaws.com` : undefined);

let client: S3Client | undefined;

function getClient(): S3Client {
  if (!BUCKET) {
    throw new StorageNotConfiguredError();
  }
  // Credentials come from the default provider chain: an IAM role on EC2, or
  // AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY locally. Never hardcoded.
  client ??= new S3Client({ region: REGION });
  return client;
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Object storage is not configured (S3_BUCKET is unset)");
    this.name = "StorageNotConfiguredError";
  }
}

export function isStorageConfigured(): boolean {
  return Boolean(BUCKET && PUBLIC_BASE_URL);
}

/**
 * Store a file and return the URL it will be served from.
 * `key` is the object key, e.g. `avatars/<userId>/<timestamp>-<name>.jpg`.
 */
export async function putObject(
  key: string,
  file: File
): Promise<{ url: string; key: string }> {
  const s3 = getClient();

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: Buffer.from(await file.arrayBuffer()),
      ContentType: file.type,
      // Immutable content-addressed-ish keys (they carry a timestamp), so a
      // long max-age is safe and keeps CloudFront from re-fetching.
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  return { url: `${PUBLIC_BASE_URL}/${key}`, key };
}

/**
 * Delete a previously stored object, given the URL we handed out.
 *
 * Returns false rather than throwing when the URL is not one of ours — a
 * user's avatar may still be an external DiceBear URL from registration, and
 * that must not be treated as a deletable object.
 */
export async function deleteObjectByUrl(url: string): Promise<boolean> {
  const key = keyFromUrl(url);
  if (!key) return false;

  await getClient().send(
    new DeleteObjectCommand({ Bucket: BUCKET, Key: key })
  );
  return true;
}

/**
 * Recover the object key from a URL we issued. Anything not sitting under our
 * public base URL is not ours and yields null.
 */
export function keyFromUrl(url: string): string | null {
  if (!PUBLIC_BASE_URL) return null;

  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(PUBLIC_BASE_URL);
  } catch {
    return null;
  }

  if (parsed.origin !== base.origin) return null;

  // Strip the base path (empty for a CloudFront root distribution) and the
  // leading slash, then undo the encoding applied when the URL was built.
  const basePath = base.pathname.replace(/\/$/, "");
  if (!parsed.pathname.startsWith(`${basePath}/`)) return null;

  const key = decodeURIComponent(parsed.pathname.slice(basePath.length + 1));
  return key.length > 0 ? key : null;
}
