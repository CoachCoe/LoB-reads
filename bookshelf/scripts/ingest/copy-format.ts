/**
 * Encoding rows for `COPY ... FROM STDIN` in text format.
 *
 * Separate from 02-stage.ts so it can be tested. The staging step streams
 * millions of rows through this and had no coverage at all, which is how the
 * NULL bug below survived: it only triggers on a dump line with an empty
 * column, and when it does it aborts the entire multi-hour COPY rather than
 * quarantining the one line.
 */

/**
 * Escape a value for COPY text format.
 *
 * Tabs, newlines and backslashes inside a value would otherwise be read as
 * delimiters or escapes.
 */
export function copyEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/** COPY's NULL marker. Must reach the server unescaped to mean NULL. */
export const COPY_NULL = "\\N";

/**
 * A value, or NULL when it is empty.
 *
 * The marker must NOT go through copyEscape. Escaping turns `\N` into `\\N`,
 * which COPY reads as the literal two-character string `\N` — and since
 * `revision` is an integer column and `last_modified` a timestamptz, the
 * stream dies with `invalid input syntax for type integer: "\N"`.
 */
export function copyValue(value: string | undefined | null): string {
  return value ? copyEscape(value) : COPY_NULL;
}

/**
 * One staging row: key, revision, last_modified, data.
 *
 * Revision and last_modified are optional in practice — the dumps are mostly
 * well formed, but "mostly" across ~50 million lines is not a guarantee.
 */
export function encodeStageRow(
  olKey: string,
  revision: string | undefined,
  lastModified: string | undefined,
  json: string
): string {
  return (
    [copyEscape(olKey), copyValue(revision), copyValue(lastModified), copyEscape(json)].join(
      "\t"
    ) + "\n"
  );
}
