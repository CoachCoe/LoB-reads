import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { createOrUpdateReview } from "@/server/reviews";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { createReviewSchema } from "@/lib/http/schemas";
import { checkLimit, LIMITS, refundHit } from "@/lib/rate-limit";

/**
 * Reviews were the one unrated write path feeding a public, anonymous read.
 *
 * `getRecentReviews(6)` renders the six newest reviews site-wide on the home
 * page, ordered createdAt desc with no moderation and no per-account share, and
 * the upsert is keyed on (userId, workKey) — so one account can hold a distinct
 * row for each of 6.9M works, each carrying 10,000 characters, and a loop over
 * popular keys owns every home-page slot indefinitely. The three
 * location/world routes were given LIMITS.contribute for exactly this shape;
 * reviews were never in that inventory.
 *
 * Recorded on arrival and refunded when nothing was written, the same policy as
 * those routes and as the login limiter: spend the budget on the work you
 * caused, so a reader whose review fails validation is not locked out.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  const limitKey = `contribute:review:${session.user.id}`;
  const limit = checkLimit(limitKey, LIMITS.contribute);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "You are posting these very quickly. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
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
    // Nothing was written, so the attempt costs nothing.
    refundHit(limitKey);
    return errorResponse("Create review error", error);
  }
}
