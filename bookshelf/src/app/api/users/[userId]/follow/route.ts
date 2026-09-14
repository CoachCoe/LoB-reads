import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { followUser, unfollowUser } from "@/server/users";
import { errorResponse, tooManyRequests, unauthorized } from "@/lib/http/api";
import { checkLimit, LIMITS, refundHit } from "@/lib/rate-limit";


/**
 * SEC-6. Unlimited follows grow app.follows without bound and inflate the
 * follower count on every targeted profile, which is a public surface.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  const limitKey = `contribute:follow:${session.user.id}`;
  const limit = checkLimit(limitKey, LIMITS.contribute);
  if (!limit.allowed) {
    return tooManyRequests(
      limit,
      "You are following people very quickly. Try again shortly."
    );
  }

  try {
    const { userId } = await params;
    await followUser(session.user.id, userId);
    return NextResponse.json({ message: "User followed" }, { status: 201 });
  } catch (error) {
    refundHit(limitKey);
    return errorResponse("Follow user error", error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  try {
    const { userId } = await params;
    await unfollowUser(session.user.id, userId);
    return NextResponse.json({ message: "User unfollowed" });
  } catch (error) {
    return errorResponse("Unfollow user error", error);
  }
}
