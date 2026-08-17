import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { createOrUpdateReview, getRecentReviews } from "@/server/reviews";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { createReviewSchema } from "@/lib/http/schemas";

export async function GET() {
  try {
    const reviews = await getRecentReviews(20);
    return NextResponse.json(reviews);
  } catch (error) {
    return errorResponse("Get reviews error", error);
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return unauthorized();
  }

  try {
    const { bookId, rating, content } = await parseBody(
      request,
      createReviewSchema
    );

    const review = await createOrUpdateReview(
      session.user.id,
      bookId,
      rating,
      content
    );

    return NextResponse.json(review, { status: 201 });
  } catch (error) {
    return errorResponse("Create review error", error);
  }
}
