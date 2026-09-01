/**
 * Whether a file already on disk can be trusted, resumed, or must be refetched.
 *
 * Extracted from 01-acquire.ts because this decision, made wrongly, produced a
 * 741.6MB archive of exactly the advertised length and entirely wrong content.
 * Appending to bytes we never fetched and never checked is the whole risk, and
 * "the size matches" is not evidence — a file stitched from two publications
 * of the same dump has precisely the right size.
 */

export interface RemoteObject {
  etag: string | null;
  lastModified: string | null;
  total: number | undefined;
}

export interface PartialMeta {
  etag: string | null;
  lastModified: string | null;
  total: number;
  verified?: boolean;
}

export type ResumeDecision =
  /** Byte-for-byte complete and previously checked. Skip it. */
  | { action: "skip" }
  /** Right length, unproven. Decompress it before trusting it. */
  | { action: "verify" }
  /** A partial belonging to this same object. Continue from `from`. */
  | { action: "resume"; from: number }
  /** Nothing usable on disk, or provenance cannot be established. */
  | { action: "restart" };

/** Does this sidecar describe the object the server is currently offering? */
function describesSameObject(
  meta: PartialMeta | null,
  remote: RemoteObject
): meta is PartialMeta {
  return (
    meta !== null &&
    meta.total === remote.total &&
    meta.etag === remote.etag &&
    meta.lastModified === remote.lastModified
  );
}

export function decideResume(
  bytesOnDisk: number,
  meta: PartialMeta | null,
  remote: RemoteObject
): ResumeDecision {
  if (bytesOnDisk === 0) return { action: "restart" };

  // Without a content-length there is nothing to compare against, so the only
  // safe reading of any existing bytes is that they are unusable.
  if (remote.total === undefined) return { action: "restart" };

  const sameObject = describesSameObject(meta, remote);

  if (bytesOnDisk === remote.total) {
    // Complete — but only skippable if something actually checked it. This is
    // the case that let the corrupt file survive: right length, no proof.
    return sameObject && meta.verified ? { action: "skip" } : { action: "verify" };
  }

  // Longer than the remote object: not a prefix of it under any reading.
  if (bytesOnDisk > remote.total) return { action: "restart" };

  return sameObject ? { action: "resume", from: bytesOnDisk } : { action: "restart" };
}
