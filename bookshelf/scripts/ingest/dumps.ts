/**
 * The Open Library dumps this pipeline consumes.
 *
 * Bulk consumers are asked to use these dumps rather than the REST API, which
 * is rate-limited and will block sustained traffic. The API remains useful for
 * low-volume lookups of records newer than the last dump.
 *
 * https://openlibrary.org/developers/dumps
 *
 * The URLs below are stable redirects: openlibrary.org answers with a 302 to
 * archive.org, which serves the file. Archive.org honours Range, so a partial
 * download resumes rather than restarting.
 */

export type DumpType = "works" | "editions" | "authors";

export interface Dump {
  type: DumpType;
  url: string;
  file: string;
  /**
   * Gzipped size, for progress reporting when a HEAD returns no
   * content-length. Measured 2026-08-17 against the 2026-07-31 dump; these
   * grow steadily, so treat them as a floor rather than a figure.
   */
  approxBytes: number;
}

export const DUMPS: Record<DumpType, Dump> = {
  authors: {
    type: "authors",
    url: "https://openlibrary.org/data/ol_dump_authors_latest.txt.gz",
    file: "ol_dump_authors_latest.txt.gz",
    approxBytes: 777_000_000,
  },
  works: {
    type: "works",
    url: "https://openlibrary.org/data/ol_dump_works_latest.txt.gz",
    file: "ol_dump_works_latest.txt.gz",
    approxBytes: 4_036_000_000,
  },
  editions: {
    type: "editions",
    url: "https://openlibrary.org/data/ol_dump_editions_latest.txt.gz",
    file: "ol_dump_editions_latest.txt.gz",
    approxBytes: 12_548_000_000,
  },
};

/**
 * Load order matters: editions reference works, works reference authors.
 * Staging is independent, but normalize must run in this order for the
 * foreign keys to resolve.
 */
export const LOAD_ORDER: DumpType[] = ["authors", "works", "editions"];

export const RAW_DIR = "data/raw";
export const QUARANTINE_DIR = "data/quarantine";

/**
 * Keys arrive prefixed — `/works/OL45804W`, `/authors/OL34184A`. Strip at stage
 * time: a prefix embedded in a primary key contaminates every join written
 * against it afterwards.
 */
export function stripKeyPrefix(key: string): string {
  const slash = key.lastIndexOf("/");
  return slash === -1 ? key : key.slice(slash + 1);
}
