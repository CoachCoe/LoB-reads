import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { canonicalKey, deleteObject, writeObject } from "./local-disk";

/**
 * Object storage for user uploads (avatars, fictional-world maps).
 *
 * Routes talk to this module, not to a vendor SDK, so replacing the backend is
 * a change to this file alone — which is exactly what happened when this moved
 * from S3 to Azure Blob Storage. The four exports below are the whole contract.
 *
 * Two backends: Azure Blob Storage, whose container is private and served
 * through Front Door, and a directory on local disk (UPLOADS_DIR) served by the
 * reverse proxy on a single VM. UPLOADS_DIR wins when both are set.
 */

const CONTAINER = process.env.AZURE_STORAGE_CONTAINER ?? "uploads";
const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const ACCOUNT = process.env.AZURE_STORAGE_ACCOUNT;
const UPLOADS_DIR = process.env.UPLOADS_DIR?.trim() || undefined;

/**
 * Storage is configured by a directory, a connection string (local development
 * against Azurite, where there is no managed identity to borrow) or an account
 * name used with the ambient credential.
 */
const CONFIGURED = Boolean(UPLOADS_DIR || CONNECTION_STRING || ACCOUNT);

/**
 * Public base URL uploads are served from — the Front Door endpoint, or the
 * account's blob endpoint when the container is deliberately public.
 *
 * Note this base carries a *path* (the container name), unlike a CloudFront
 * root distribution. keyFromUrl strips it, which is why it works off
 * `base.pathname` rather than assuming the key starts at the first slash.
 */
function blobEndpoint(): string | undefined {
  if (ACCOUNT) {
    return `https://${ACCOUNT}.blob.core.windows.net/${CONTAINER}`;
  }
  // Azurite's connection string carries an explicit endpoint, including the
  // account name in the path — http://127.0.0.1:10000/devstoreaccount1.
  const match = CONNECTION_STRING?.match(/BlobEndpoint=([^;]+)/);
  if (match) return `${match[1].replace(/\/$/, "")}/${CONTAINER}`;

  const name = CONNECTION_STRING?.match(/AccountName=([^;]+)/)?.[1];
  return name
    ? `https://${name}.blob.core.windows.net/${CONTAINER}`
    : undefined;
}

// A directory has no endpoint of its own to fall back to: whatever serves it is
// named only by CDN_URL.
const PUBLIC_BASE_URL =
  process.env.CDN_URL?.replace(/\/$/, "") ??
  (UPLOADS_DIR ? undefined : blobEndpoint());

/**
 * Whether the container allows anonymous blob reads, so the blob endpoint can
 * serve uploads directly with no CDN in front.
 *
 * This has to be stated rather than assumed. The container is private by
 * default, which means a deployment with credentials but no CDN would accept
 * every upload and then serve a 403 for the image — storage that reports itself
 * configured and produces nothing but broken pictures. Verified against
 * Azurite: the blob endpoint refuses an anonymous GET.
 *
 * So serving needs one of the two to be true, and both are explicit.
 */
const CONTAINER_IS_PUBLIC =
  process.env.AZURE_STORAGE_PUBLIC_CONTAINER === "true";

let container: ContainerClient | undefined;

function getContainer(): ContainerClient {
  if (!CONFIGURED) {
    throw new StorageNotConfiguredError();
  }

  if (!container) {
    // Credentials are ambient in production — a managed identity on Container
    // Apps — and a connection string only locally. Never hardcoded.
    const service = CONNECTION_STRING
      ? BlobServiceClient.fromConnectionString(CONNECTION_STRING)
      : new BlobServiceClient(
          `https://${ACCOUNT}.blob.core.windows.net`,
          new DefaultAzureCredential()
        );
    container = service.getContainerClient(CONTAINER);
  }
  return container;
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "Object storage is not configured (set UPLOADS_DIR, AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT)"
    );
    this.name = "StorageNotConfiguredError";
  }
}

/**
 * Whether a CDN is in front of the container.
 *
 * Captured at module load, like every other setting here. `isStorageConfigured`
 * used to read `process.env.CDN_URL` at CALL time instead, which made this one
 * module half-static and half-dynamic — and made its behaviour depend on the
 * ambient environment rather than on the environment the module was imported
 * with. That is not theoretical: it is why storage.test.ts passed locally and
 * failed in CI, where CDN_URL is set for the whole job.
 */
const CDN_IN_FRONT = Boolean(process.env.CDN_URL);

export function isStorageConfigured(): boolean {
  const canBeServed = CDN_IN_FRONT || CONTAINER_IS_PUBLIC;
  return Boolean(CONFIGURED && PUBLIC_BASE_URL && canBeServed);
}

/**
 * Store a file and return the URL it will be served from.
 * `key` is the blob name, e.g. `avatars/<userId>/<timestamp>-<name>.jpg`.
 */
export async function putObject(
  key: string,
  file: File
): Promise<{ url: string; key: string }> {
  if (UPLOADS_DIR) {
    // Callers must use the returned key and URL: the extension may differ from
    // the one they asked for.
    const stored = canonicalKey(key, file.type);
    await writeObject(UPLOADS_DIR, stored, new Uint8Array(await file.arrayBuffer()));
    return { url: `${PUBLIC_BASE_URL}/${stored}`, key: stored };
  }

  const blob = getContainer().getBlockBlobClient(key);

  await blob.uploadData(Buffer.from(await file.arrayBuffer()), {
    blobHTTPHeaders: {
      blobContentType: file.type,
      // Keys carry a timestamp, so a stored object never changes and a long
      // max-age keeps the CDN from re-fetching.
      blobCacheControl: "public, max-age=31536000, immutable",
    },
  });

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

  if (UPLOADS_DIR) return deleteObject(UPLOADS_DIR, key);

  await getContainer().getBlockBlobClient(key).deleteIfExists();
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

  // Strip the base path — the container name on a blob endpoint, empty on a
  // CDN root — and the leading slash, then undo the encoding applied when the
  // URL was built.
  const basePath = base.pathname.replace(/\/$/, "");
  if (!parsed.pathname.startsWith(`${basePath}/`)) return null;

  const key = decodeURIComponent(parsed.pathname.slice(basePath.length + 1));
  return key.length > 0 ? key : null;
}
