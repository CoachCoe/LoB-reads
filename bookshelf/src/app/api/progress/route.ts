import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import {
  getCurrentlyReading,
  getLatestSessionForWork,
  updateProgress,
  startReading,
  finishReading,
} from "@/server/progress";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { updateProgressSchema } from "@/lib/http/schemas";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  try {
    // With ?workKey=, the LATEST session for that work whether or not it is
    // finished. Without it, the open sessions — the "currently reading" list.
    // A work page needs the former: filtering to open sessions made a finished
    // book look unread. Returns null rather than 404 so the caller can treat
    // "never started" and "finished" the same way.
    const workKey = new URL(request.url).searchParams.get("workKey");
    if (workKey) {
      return NextResponse.json(
        await getLatestSessionForWork(session.user.id, workKey)
      );
    }

    const progress = await getCurrentlyReading(session.user.id);
    return NextResponse.json(progress);
  } catch (error) {
    return errorResponse("Get progress error", error);
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  try {
    const { workKey, editionKey, currentPage, action } = await parseBody(
      request,
      updateProgressSchema
    );
    const userId = session.user.id;

    if (action === "start") {
      return NextResponse.json(await startReading(userId, workKey, editionKey));
    }

    if (action === "finish") {
      return NextResponse.json(await finishReading(userId, workKey));
    }

    // The schema guarantees one of action/currentPage is present.
    return NextResponse.json(
      await updateProgress(userId, workKey, currentPage!)
    );
  } catch (error) {
    return errorResponse("Update progress error", error);
  }
}
