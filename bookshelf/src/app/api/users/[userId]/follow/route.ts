import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { followUser, unfollowUser, isFollowing } from "@/server/users";
import { errorResponse, unauthorized } from "@/lib/http/api";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  try {
    const { userId } = await params;
    const following = await isFollowing(session.user.id, userId);
    return NextResponse.json({ isFollowing: following });
  } catch (error) {
    return errorResponse("Check follow error", error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  try {
    const { userId } = await params;
    await followUser(session.user.id, userId);
    return NextResponse.json({ message: "User followed" }, { status: 201 });
  } catch (error) {
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
