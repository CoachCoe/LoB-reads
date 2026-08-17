import { NextResponse } from "next/server";
import { getWorkEditions, EDITIONS_PAGE_SIZE } from "@/server/catalog";
import { errorResponse } from "@/lib/http/api";

/**
 * Further pages of a work's editions. Public: the catalog is public-domain
 * data and carries nothing user-specific.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workKey: string }> }
) {
  try {
    const { workKey } = await params;
    const { searchParams } = new URL(request.url);

    // Clamped rather than trusted: an unbounded limit is a cheap way to make
    // the server do arbitrary work.
    const limit = clamp(searchParams.get("limit"), EDITIONS_PAGE_SIZE, 1, 100);
    const offset = clamp(searchParams.get("offset"), 0, 0, 10_000);

    return NextResponse.json(await getWorkEditions(workKey, { limit, offset }));
  } catch (error) {
    return errorResponse("Get work editions error", error);
  }
}

function clamp(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}
