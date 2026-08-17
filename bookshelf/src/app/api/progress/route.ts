import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import {
  getUserCurrentlyReading,
  updateReadingProgress,
  startReading,
  finishReading,
} from "@/server/progress";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { updateProgressSchema } from "@/lib/http/schemas";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return unauthorized();
  }

  try {
    const progress = await getUserCurrentlyReading(session.user.id);
    return NextResponse.json(progress);
  } catch (error) {
    return errorResponse("Get progress error", error);
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return unauthorized();
  }

  try {
    const { bookId, currentPage, action } = await parseBody(
      request,
      updateProgressSchema
    );
    const userId = session.user.id;

    if (action === "start") {
      return NextResponse.json(await startReading(userId, bookId));
    }

    if (action === "finish") {
      return NextResponse.json(await finishReading(userId, bookId));
    }

    // The schema guarantees one of action/currentPage is present.
    return NextResponse.json(
      await updateReadingProgress(userId, bookId, currentPage!)
    );
  } catch (error) {
    return errorResponse("Update progress error", error);
  }
}
