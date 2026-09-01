import { NextResponse } from "next/server";

/**
 * Liveness probe.
 *
 * Deliberately checks nothing. A liveness probe answers "is this process
 * wedged, should the orchestrator kill it" — so it must not depend on the
 * database. A probe that fails when Postgres hiccups turns a brief database
 * blip into a restart loop across every replica, which is strictly worse than
 * serving errors for a few seconds.
 *
 * Readiness — "can this replica serve traffic" — is `/api/health/ready`.
 */

// Without this the route is prerendered at build time and served as a static
// asset, which would report healthy even from a broken deployment.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: "ok" });
}
