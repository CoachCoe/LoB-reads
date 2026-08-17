import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { skipRow } from "@/server/imports";
import { errorResponse, unauthorized } from "@/lib/http/api";

/** The reader decided this row is not worth resolving. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  const user = await getCurrentUser();
  if (!user?.id) return unauthorized();

  try {
    const { rowId } = await params;
    await skipRow(user.id, rowId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("Skip import row error", error);
  }
}
