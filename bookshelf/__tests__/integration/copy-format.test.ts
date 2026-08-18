import { Client } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { encodeStageRow, copyEscape, copyValue } from "../../scripts/ingest/copy-format";

/**
 * Row encoding for the ingest's COPY stream.
 *
 * Asserted by feeding the encoded rows to a real COPY rather than by comparing
 * strings. String comparison would have happily confirmed the bug this file
 * exists for: `\N` escaped to `\\N` looks like correct escaping, and is, for a
 * text column. It is only wrong because it stops meaning NULL — which nothing
 * reveals until Postgres tries to read it as an integer, mid-way through a
 * multi-hour stream, and aborts the whole thing.
 *
 * Staging had no tests at all before this.
 */

/**
 * Feed encoded rows through a real `COPY ... FROM STDIN`.
 *
 * A real COPY, not a hand-written parse of the same bytes. Decoding `\N`
 * ourselves would make the test agree with whatever the encoder does, which is
 * precisely the mistake that lets an escaping bug pass — Postgres has to be
 * the one interpreting the stream.
 *
 * Prisma cannot express COPY FROM STDIN, so this uses a direct pg client on
 * the same database.
 */
let client: Client;

beforeAll(async () => {
  client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS catalog.copy_format_test (
      ol_key text, revision integer, last_modified timestamptz, data jsonb
    )`);
});

async function copyInto(rows: string[]): Promise<void> {
  await client.query(`TRUNCATE catalog.copy_format_test`);
  const stream = client.query(
    copyFrom(
      `COPY catalog.copy_format_test (ol_key, revision, last_modified, data) FROM STDIN`
    )
  );
  await pipeline(Readable.from(rows), stream);
}

afterAll(async () => {
  await client.query(`DROP TABLE IF EXISTS catalog.copy_format_test`);
  await client.end();
});

describe("COPY row encoding", () => {
  it("writes NULL, not the string \\N, for an empty revision", async () => {
    // The bug: copyEscape("\\N") produces "\\\\N", which COPY reads as the
    // literal text \N. Against an integer column that is not a wrong value, it
    // is a hard error that kills the stream.
    const encoded = encodeStageRow("OL1A", undefined, undefined, "{}");
    const [, revision, lastModified] = encoded.replace(/\n$/, "").split("\t");

    expect(revision).toBe("\\N");
    expect(lastModified).toBe("\\N");
    // Not the escaped form, which is what broke.
    expect(revision).not.toBe("\\\\N");
  });

  it("survives a real COPY of a row with empty columns", async () => {
    await expect(
      copyInto([encodeStageRow("OL1A", undefined, undefined, '{"name":"x"}')])
    ).resolves.not.toThrow();

    const { rows } = await client.query<{ ol_key: string; revision: number | null }>(
      `SELECT ol_key, revision FROM catalog.copy_format_test`
    );
    const row = rows[0];

    expect(row.ol_key).toBe("OL1A");
    expect(row.revision).toBeNull();
  });

  it("keeps a present revision and timestamp intact", async () => {
    await copyInto([
      encodeStageRow("OL2A", "7", "2026-07-31T12:00:00Z", '{"name":"y"}'),
    ]);

    const { rows } = await client.query<{ revision: number; last_modified: Date }>(
      `SELECT revision, last_modified FROM catalog.copy_format_test`
    );
    const row = rows[0];

    expect(row.revision).toBe(7);
    expect(row.last_modified.toISOString()).toBe("2026-07-31T12:00:00.000Z");
  });

  it("escapes a raw tab so it cannot split the row", async () => {
    // Deliberately not via JSON.stringify, which escapes tabs itself — a test
    // built on it passes whether or not the encoder escapes anything, and this
    // one did until a mutation exposed it. The tab goes in a text field, where
    // it survives to reach the encoder.
    const encoded = encodeStageRow("OL3A\tinjected", "1", undefined, "{}");

    // Four fields, not five: the tab was escaped rather than acting as a
    // boundary. Unescaped, everything after it shifts one column left — the
    // same class of bug as the Goodreads CSV newline, and just as silent.
    expect(encoded.replace(/\n$/, "").split("\t")).toHaveLength(4);

    await copyInto([encoded]);
    const { rows } = await client.query<{ ol_key: string }>(
      `SELECT ol_key FROM catalog.copy_format_test`
    );
    expect(rows[0].ol_key).toBe("OL3A\tinjected");
  });

  it("escapes a newline inside JSON so it cannot end the row", async () => {
    const json = JSON.stringify({ bio: "first\nsecond" });
    const encoded = encodeStageRow("OL4A", "1", undefined, json);

    // Exactly one trailing newline: the row terminator, not the value's.
    expect(encoded.match(/\n/g)).toHaveLength(1);
  });

  it("escapes a backslash so it survives the round trip", async () => {
    const json = JSON.stringify({ bio: "back\\slash" });
    await copyInto([encodeStageRow("OL5A", "1", undefined, json)]);

    const { rows } = await client.query<{ data: { bio: string } }>(
      `SELECT data FROM catalog.copy_format_test`
    );
    expect(rows[0].data.bio).toBe("back\\slash");
  });
});

describe("copyValue", () => {
  it("treats an empty string as NULL rather than as a value", () => {
    // The dumps use an empty column for absent, not a marker.
    expect(copyValue("")).toBe("\\N");
    expect(copyValue(undefined)).toBe("\\N");
    expect(copyValue(null)).toBe("\\N");
  });

  it("escapes a value that happens to contain a backslash", () => {
    expect(copyValue("a\\b")).toBe("a\\\\b");
  });
});

describe("copyEscape", () => {
  it("leaves ordinary text alone", () => {
    expect(copyEscape("Ursula K. Le Guin")).toBe("Ursula K. Le Guin");
  });

  it("escapes the four characters COPY treats specially", () => {
    expect(copyEscape("a\\b\tc\nd\re")).toBe("a\\\\b\\tc\\nd\\re");
  });
});
