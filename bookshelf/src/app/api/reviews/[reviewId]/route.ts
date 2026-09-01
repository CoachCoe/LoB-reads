import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { deleteReview } from "@/server/reviews";
import { errorResponse, unauthorized } from "@/lib/http/api";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  try {
    const { reviewId } = await params;
    await deleteReview(reviewId, session.user.id);
    return NextResponse.json({ message: "Review deleted" });
  } catch (error) {
    return errorResponse("Delete review error", error);
  }
}
