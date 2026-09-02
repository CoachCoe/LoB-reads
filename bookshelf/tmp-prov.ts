import { computeSimilarity } from "./scripts/social/compute-stats";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  for (const includeSeed of [false, true]) {
    try {
      await computeSimilarity({ includeSeed } as never);
      const r = await p.$queryRawUnsafe<{ pairs: bigint; owed: bigint; free: bigint }[]>(`
        SELECT count(*) AS pairs,
               count(*) FILTER (WHERE seed_co_raters IS NULL OR seed_co_raters > 0) AS owed,
               count(*) FILTER (WHERE seed_co_raters = 0) AS free
        FROM catalog.work_similarity`);
      const { pairs, owed, free } = r[0];
      console.log(`RESULT includeSeed=${String(includeSeed).padEnd(5)} pairs=${Number(pairs)}  attributionOwed=${Number(owed)}  readerOnly=${Number(free)}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      console.log("RESULT ERROR", includeSeed, m.split("\n").filter(l=>/does not exist|syntax|column/i.test(l)).slice(0,2).join(" | ").slice(0,200));
    }
  }
})().finally(() => p.$disconnect());
