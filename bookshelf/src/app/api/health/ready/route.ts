import { NextResponse } from "next/server";
import { checkCatalogHealth } from "@/server/health";

/**
 * Readiness probe: can this replica actually serve a request?
 *
 * It checks the two things that have broken a deployment while the process
 * itself stayed up:
 *
 *   - the database answers at all. The container that shipped with a Prisma
 *     query engine it could not load started cleanly, served static pages, and
 *     returned 500 on every page that touched the database. A probe that only
 *     checked the process would have called that deployment healthy.
 *   - the catalog has rows. A restore that is still running, or one that
 *     silently restored nothing, leaves every search empty while the app looks
 *     fine.
 *
 * It does NOT check object storage. Uploads being unavailable is a degraded
 * feature, not a reason to take a replica out of the load balancer.
 *
 * Liveness — "is this process wedged" — is `/api/health`, and deliberately
 * checks nothing.
 */

// Without this the route is prerendered at build time and served as a static
// asset, which would report healthy even from a broken deployment.
export const dynamic = "force-dynamic";

export async function GET() {
  const catalog = await checkCatalogHealth();

  if (catalog === "unreachable") {
    return NextResponse.json(
      { status: "unavailable", database: "down" },
      { status: 503 }
    );
  }

  if (catalog === "empty") {
    return NextResponse.json(
      { status: "degraded", database: "up", catalog: "empty" },
      { status: 503 }
    );
  }

  return NextResponse.json({
    status: "ok",
    database: "up",
    catalog: "populated",
  });
}
