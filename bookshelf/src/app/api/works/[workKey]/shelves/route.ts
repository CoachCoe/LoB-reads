import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { getWorkShelfStatus } from "@/server/shelves";
import { errorResponse, unauthorized } from "@/lib/http/api";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workKey: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  try {
    const { workKey } = await params;
    const status = await getWorkShelfStatus(session.user.id, workKey);
    return NextResponse.json(status);
  } catch (error) {
    // errorResponse, not a hand-rolled 500. This was the one route in the
    // shelving path that rolled its own, so a P2025 here answered 500 where
    // every sibling answers 404 — in a path whose single error mapper calls
    // itself "the single place where a thrown error becomes a response".
    return errorResponse("Get work shelf status error", error);
  }
}
