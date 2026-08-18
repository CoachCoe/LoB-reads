import { decideResume, type PartialMeta } from "../../scripts/ingest/resume-policy";

/**
 * The rules that decide whether bytes already on disk can be trusted.
 *
 * Written after the acquire step produced a 741.6MB archive of exactly the
 * advertised length and entirely wrong content: it resumed onto 11KB left by
 * an earlier failed attempt, and nothing checked that those 11KB belonged to
 * the dump being fetched. The finished file then matched content-length, so
 * the next run skipped it as "already complete". The only symptom was
 * `gzip: trailing garbage ignored`, hours before anything downstream cared.
 *
 * Every case below is a way of ending up with a file that is the right size
 * and wrong.
 */

const TOTAL = 777_579_419;

const remote = {
  etag: '"6a6f56ef-2e58eb9b"',
  lastModified: "Sun, 02 Aug 2026 14:40:47 GMT",
  total: TOTAL as number | undefined,
};

const matchingMeta: PartialMeta = {
  etag: remote.etag,
  lastModified: remote.lastModified,
  total: TOTAL,
};

describe("deciding whether to resume a download", () => {
  it("starts fresh when there is nothing on disk", () => {
    expect(decideResume(0, null, remote)).toEqual({ action: "restart" });
  });

  it("resumes a partial that provably belongs to this object", () => {
    expect(decideResume(11_565, matchingMeta, remote)).toEqual({
      action: "resume",
      from: 11_565,
    });
  });

  it("refuses to resume a partial with no provenance", () => {
    // The actual bug: bytes of unknown origin get appended to, and the result
    // is the right length and unusable.
    expect(decideResume(11_565, null, remote)).toEqual({ action: "restart" });
  });

  it("refuses to resume across a republication of the dump", () => {
    // Open Library republishes monthly. Yesterday's partial plus today's
    // remainder is a file no version of the dump ever contained.
    const yesterday: PartialMeta = {
      ...matchingMeta,
      etag: '"older-etag"',
      lastModified: "Fri, 03 Jul 2026 09:00:00 GMT",
    };
    expect(decideResume(11_565, yesterday, remote)).toEqual({ action: "restart" });
  });

  it("refuses to resume when the recorded size disagrees", () => {
    const differentSize: PartialMeta = { ...matchingMeta, total: TOTAL - 1 };
    expect(decideResume(11_565, differentSize, remote)).toEqual({
      action: "restart",
    });
  });

  it("skips a complete file only when something verified it", () => {
    expect(
      decideResume(TOTAL, { ...matchingMeta, verified: true }, remote)
    ).toEqual({ action: "skip" });
  });

  it("verifies a complete file that was never checked", () => {
    // Right length, no proof — exactly the state the corrupt archive was in,
    // and the reason the next run skipped it.
    expect(decideResume(TOTAL, matchingMeta, remote)).toEqual({ action: "verify" });
  });

  it("verifies rather than skips when the file predates the sidecar", () => {
    expect(decideResume(TOTAL, null, remote)).toEqual({ action: "verify" });
  });

  it("restarts when the file is longer than the remote object", () => {
    // It cannot be a prefix of it, so it is not resumable under any reading.
    expect(decideResume(TOTAL + 1, matchingMeta, remote)).toEqual({
      action: "restart",
    });
  });

  it("restarts when the server gives no content-length", () => {
    // With no length there is nothing to compare, so existing bytes cannot be
    // shown to be a prefix of anything.
    expect(
      decideResume(11_565, matchingMeta, { ...remote, total: undefined })
    ).toEqual({ action: "restart" });
  });
});
