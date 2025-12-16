import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { deleteReview } from "@/server/reviews";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { reviewId } = await params;
    await deleteReview(reviewId, session.user.id);
    return NextResponse.json({ message: "Review deleted" });
  } catch (error) {
    console.error("Delete review error:", error);
    const message = error instanceof Error ? error.message : "Failed to delete review";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
