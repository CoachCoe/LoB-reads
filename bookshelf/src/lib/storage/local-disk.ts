import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Uploads kept on the host's own disk and served by the reverse proxy in front
 * of the app — the single-VM deployment, where the database already lives on
 * the same volume and one backup covers both.
 *
 * The proxy picks Content-Type from the file extension, and the extension in a
 * key comes from the uploader's filename. Blob storage recorded the validated
 * MIME type alongside the bytes, so a PNG named `x.html` was still served as
 * image/png; a file server would serve it as text/html on the app's own origin.
 * So the extension is derived from the validated type and the one in the key
 * is discarded.
 */

const EXTENSION_FOR_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export function canonicalKey(key: string, contentType: string): string {
  const extension = EXTENSION_FOR_TYPE[contentType];
  if (!extension) {
    throw new Error(
      `Refusing to store ${contentType || "an untyped file"}: only validated image types are served from disk`
    );
  }
  const slash = key.lastIndexOf("/");
  const dot = key.lastIndexOf(".");
  const stem = dot > slash + 1 ? key.slice(0, dot) : key;
  return `${stem}${extension}`;
}

/**
 * The absolute path for a key, or null when the key would land outside the
 * uploads directory.
 *
 * Reachable, not hypothetical: `keyFromUrl` percent-decodes, so a profile whose
 * avatarUrl ends `avatars/<own id>/..%2F..%2F<target>` yields a key that passes
 * the avatar route's own-prefix check and resolves anywhere on the filesystem
 * the app can write.
 */
export function resolveWithin(root: string, key: string): string | null {
  const base = path.resolve(root);
  const target = path.resolve(base, key);
  return target.startsWith(base + path.sep) ? target : null;
}

export async function writeObject(
  root: string,
  key: string,
  bytes: Uint8Array
): Promise<void> {
  const target = resolveWithin(root, key);
  if (!target) throw new Error(`Object key escapes the uploads directory: ${key}`);

  await mkdir(path.dirname(target), { recursive: true });
  // Written aside and renamed so the proxy never serves a half-written image.
  const partial = `${target}.${randomUUID()}.partial`;
  try {
    await writeFile(partial, bytes, { flag: "wx" });
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

/** Returns false when the key is not one this directory could hold. */
export async function deleteObject(root: string, key: string): Promise<boolean> {
  const target = resolveWithin(root, key);
  if (!target) return false;
  await rm(target, { force: true });
  return true;
}
