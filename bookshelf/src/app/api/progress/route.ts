import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserCurrentlyReading, updateReadingProgress, startReading, finishReading } from "@/server/progress";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const progress = await getUserCurrentlyReading(session.user.id);
    return NextResponse.json(progress);
  } catch (error) {
    console.error("Get progress error:", error);
    return NextResponse.json({ error: "Failed to fetch progress" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { bookId, currentPage, action } = await request.json();

    if (!bookId) {
      return NextResponse.json({ error: "Book ID is required" }, { status: 400 });
    }

    let progress;

    if (action === "start") {
      progress = await startReading(session.user.id, bookId);
    } else if (action === "finish") {
      progress = await finishReading(session.user.id, bookId);
    } else if (currentPage !== undefined) {
      progress = await updateReadingProgress(session.user.id, bookId, currentPage);
    } else {
      return NextResponse.json(
        { error: "Either action or currentPage is required" },
        { status: 400 }
      );
    }

    return NextResponse.json(progress);
  } catch (error) {
    console.error("Update progress error:", error);
    const message = error instanceof Error ? error.message : "Failed to update progress";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
