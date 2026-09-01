import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { createOrUpdateReview } from "@/server/reviews";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { createReviewSchema } from "@/lib/http/schemas";


export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  try {
    const { workKey, rating, content } = await parseBody(
      request,
      createReviewSchema
    );

    const review = await createOrUpdateReview(
      session.user.id,
      workKey,
      rating,
      content
    );

    return NextResponse.json(review, { status: 201 });
  } catch (error) {
    return errorResponse("Create review error", error);
  }
}
