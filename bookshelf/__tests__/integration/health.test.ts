import { prisma, clearTestCatalogRows } from "./setup";
import { makeWork } from "./factories";

/**
 * The probes an orchestrator uses to decide whether to route traffic to a
 * replica, and whether to kill it.
 *
 * Both distinctions here are load-bearing and neither is obvious:
 *
 *   - liveness must NOT depend on the database. A probe that fails when
 *     Postgres hiccups turns a brief blip into a restart loop across every
 *     replica, which is worse than serving errors for a few seconds.
 *   - readiness must fail when the catalog is empty. A restore that is still
 *     running, or one that silently restored nothing, leaves the process
 *     perfectly healthy and every search empty.
 */

import { GET as liveness } from "@/app/api/health/route";
import { GET as readiness } from "@/app/api/health/ready/route";

/**
 * Two tests here require an EMPTY catalog, and this file used to just assume
 * one. The global beforeEach truncates `app.*` only, so the emptiness came
 * from every alphabetically-earlier catalog-writing file happening to clean up
 * after itself — seeding a single row under a prefix the cleanup helper did
 * not recognise failed both of them. A precondition a test depends on is the
 * test's own to establish.
 */
beforeEach(async () => {
  await clearTestCatalogRows();
});

describe("liveness", () => {
  it("returns 200 and touches nothing", async () => {
    const response = await liveness();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("still returns 200 when the catalog is empty", async () => {
    // The beforeEach above empties the catalog, so this is a stated
    // precondition rather than an inherited one. Liveness must not care —
    // this is the check that keeps a database outage from becoming a restart
    // loop.
    //
    // Catalog tables are reached by raw SQL, not Prisma models, because the
    // catalog is rebuilt wholesale outside Prisma's ownership.
    const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM catalog.works`;
    expect(Number(count)).toBe(0);
    expect((await liveness()).status).toBe(200);
  });
});

describe("readiness", () => {
  it("reports 503 while the catalog is empty", async () => {
    const response = await readiness();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      database: "up",
      catalog: "empty",
    });
  });

  it("reports 200 once the catalog has rows", async () => {
    await makeWork();

    const response = await readiness();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      database: "up",
      catalog: "populated",
    });
  });

  it("does not leak connection detail when the database is unreachable", async () => {
    // The thrown message can carry the connection string and schema names, so
    // the handler must log it rather than return it.
    const spy = jest
      .spyOn(prisma, "$queryRaw")
      .mockRejectedValue(
        new Error("connect ECONNREFUSED 10.0.0.4:5432 for user 'admin'")
      );
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    const response = await readiness();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "unavailable", database: "down" });
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.4|admin/);

    spy.mockRestore();
    consoleError.mockRestore();
  });
});
