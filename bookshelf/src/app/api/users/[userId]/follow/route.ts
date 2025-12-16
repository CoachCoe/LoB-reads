import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { followUser, unfollowUser, isFollowing } from "@/server/users";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { userId } = await params;
    const following = await isFollowing(session.user.id, userId);
    return NextResponse.json({ isFollowing: following });
  } catch (error) {
    console.error("Check follow error:", error);
    return NextResponse.json({ error: "Failed to check follow status" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { userId } = await params;
    await followUser(session.user.id, userId);
    return NextResponse.json({ message: "User followed" }, { status: 201 });
  } catch (error) {
    console.error("Follow user error:", error);
    const message = error instanceof Error ? error.message : "Failed to follow user";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { userId } = await params;
    await unfollowUser(session.user.id, userId);
    return NextResponse.json({ message: "User unfollowed" });
  } catch (error) {
    console.error("Unfollow user error:", error);
    return NextResponse.json({ error: "Failed to unfollow user" }, { status: 400 });
  }
}
