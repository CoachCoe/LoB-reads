import { parseStageArgs } from "../../scripts/ingest/args";

/**
 * Command line parsing for the staging script.
 *
 * The first case below is the bug that prompted this file. With no `--limit`,
 * `indexOf` returns -1, so the old guard `i !== limitIndex + 1` read as
 * `i !== 0` and silently dropped the first positional argument. Asking for one
 * dump therefore staged all three — and quietly loaded whatever else happened
 * to be sitting in data/raw/, which during this work meant CI fixtures landing
 * in the staging tables alongside 15 million real author records.
 *
 * Nothing failed. The script reported success for every dump it staged.
 */

describe("parseStageArgs", () => {
  it("stages only the dump that was asked for", () => {
    // The regression. Previously returned all three.
    expect(parseStageArgs(["authors"])).toEqual({
      selected: ["authors"],
      limit: undefined,
    });
  });

  it("accepts several dumps", () => {
    expect(parseStageArgs(["works", "editions"]).selected).toEqual([
      "works",
      "editions",
    ]);
  });

  it("stages everything when nothing is named", () => {
    expect(parseStageArgs([]).selected).toEqual(["authors", "works", "editions"]);
  });

  it("reads --limit after the dump name", () => {
    expect(parseStageArgs(["works", "--limit", "5000"])).toEqual({
      selected: ["works"],
      limit: 5000,
    });
  });

  it("reads --limit before the dump name", () => {
    expect(parseStageArgs(["--limit", "5000", "works"])).toEqual({
      selected: ["works"],
      limit: 5000,
    });
  });

  it("does not mistake a dump name for the --limit value", () => {
    // Only the argument immediately after --limit is consumed as its value.
    expect(parseStageArgs(["--limit", "10", "authors", "works"]).selected).toEqual([
      "authors",
      "works",
    ]);
  });

  it("rejects an unknown dump rather than silently staging everything", () => {
    // Falling back to all three on a typo is how a one-dump run becomes a
    // twelve-gigabyte one.
    expect(() => parseStageArgs(["authorz"])).toThrow(/unknown dump/i);
  });

  it("rejects a --limit that is not a positive whole number", () => {
    expect(() => parseStageArgs(["--limit", "abc", "works"])).toThrow(/--limit/);
    expect(() => parseStageArgs(["--limit", "0", "works"])).toThrow(/--limit/);
    expect(() => parseStageArgs(["--limit", "-5", "works"])).toThrow(/--limit/);
    expect(() => parseStageArgs(["works", "--limit"])).toThrow(/--limit/);
  });
});
