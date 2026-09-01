import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { confirmMatch } from "@/server/imports";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { confirmImportRowSchema } from "@/lib/http/schemas";

/** The reader chose a candidate for a row that did not match exactly. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ rowId: string }> }
) {
  const user = await getCurrentUser();
  if (!user?.id) return unauthorized();

  try {
    const { rowId } = await params;
    const { workKey } = await parseBody(request, confirmImportRowSchema);
    await confirmMatch(user.id, rowId, workKey);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("Confirm import match error", error);
  }
}
