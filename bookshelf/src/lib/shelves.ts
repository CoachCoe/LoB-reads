/**
 * The three exclusive shelf names, and the mapping from a Goodreads shelf to
 * one of them.
 *
 * Here rather than in `src/server/shelves.ts` because a client component needs
 * the labels — `ImportReviewList` renders them — and `conventions.test.ts`
 * forbids a client component importing `src/server/*`. This module holds no
 * database access, so both sides can share it.
 *
 * DEAD-2: the name was silently a JOIN KEY. `applyRow` looks a shelf up by the
 * string `getShelfDisplayName` returns, against a map keyed on the names
 * `createUserWithDefaultShelves` created from `DEFAULT_SHELF_NAMES` — and the
 * two were unrelated string literals in different files. Renaming a shelf in
 * `shelves.ts` was a compile error in `progress.ts`, which is typed against
 * the const, and NOT in `goodreads.ts`, which had its own copy. Every
 * `to-read` row of every import would then land `status: "failed"`, reason
 * "no matching shelf on this account" — a silent halving of import success,
 * reported through a column nothing renders.
 *
 * Both sides were pinned by tests, independently, so a rename that updated one
 * list and its own test stayed green. Deriving one from the other is what makes
 * the drift a type error instead.
 *
 * A third copy in `prisma/seed.ts` stays where it is and is justified in place:
 * the seed runs under `tsx` outside the Next module graph, so `@/` does not
 * resolve there.
 */

/** The three shelves every account starts with. Order is the display order. */
export const DEFAULT_SHELF_NAMES = [
  "Want to Read",
  "Currently Reading",
  "Read",
] as const;

export type DefaultShelfName = (typeof DEFAULT_SHELF_NAMES)[number];

/** The `exclusiveShelf` values a Goodreads export uses. */
export type GoodreadsShelf = "read" | "currently-reading" | "to-read";

/**
 * Goodreads' shelf identifier to ours.
 *
 * Typed as a total map to `DefaultShelfName`, so renaming a shelf in
 * DEFAULT_SHELF_NAMES fails to compile here rather than failing at import time
 * for every reader.
 */
export const SHELF_NAME_BY_GOODREADS_SHELF: Record<
  GoodreadsShelf,
  DefaultShelfName
> = {
  read: "Read",
  "currently-reading": "Currently Reading",
  "to-read": "Want to Read",
};
