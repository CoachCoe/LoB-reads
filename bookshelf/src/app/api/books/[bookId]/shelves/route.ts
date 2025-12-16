import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getBookShelfStatus } from "@/server/shelves";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { bookId } = await params;
    const status = await getBookShelfStatus(session.user.id, bookId);
    return NextResponse.json(status);
  } catch (error) {
    console.error("Get book shelf status error:", error);
    return NextResponse.json(
      { error: "Failed to get shelf status" },
      { status: 500 }
    );
  }
}
