import { LOAD_ORDER, type DumpType } from "./dumps";

/**
 * Parse the staging script's command line.
 *
 * Extracted because the inline version silently ignored the dump selection:
 * with no `--limit`, `indexOf` returns -1, so the guard `i !== limitIndex + 1`
 * became `i !== 0` and dropped the first positional argument. `02-stage.ts
 * authors` therefore staged all three dumps.
 *
 * That is a quiet failure with an expensive shape — staging every dump instead
 * of one, and, if a stale or fixture archive happens to be sitting in
 * data/raw/, loading it over real staged data.
 */
export interface StageArgs {
  selected: DumpType[];
  limit?: number;
}

export function parseStageArgs(argv: string[]): StageArgs {
  const limitIndex = argv.indexOf("--limit");
  const hasLimit = limitIndex !== -1;

  const rawLimit = hasLimit ? Number(argv[limitIndex + 1]) : undefined;
  if (hasLimit && (!Number.isInteger(rawLimit) || rawLimit! <= 0)) {
    throw new Error(
      `--limit needs a positive whole number, got "${argv[limitIndex + 1] ?? ""}"`
    );
  }

  const positional = argv.filter(
    (arg, i) =>
      !arg.startsWith("--") &&
      // Only the value immediately after --limit is consumed, and only when
      // --limit is actually present.
      !(hasLimit && i === limitIndex + 1)
  ) as DumpType[];

  for (const type of positional) {
    if (!LOAD_ORDER.includes(type)) {
      throw new Error(
        `Unknown dump "${type}". Expected one of: ${LOAD_ORDER.join(", ")}`
      );
    }
  }

  return {
    selected: positional.length > 0 ? positional : LOAD_ORDER,
    limit: rawLimit,
  };
}
