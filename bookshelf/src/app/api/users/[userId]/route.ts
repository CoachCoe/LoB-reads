import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { getUserProfile, updateUserProfile } from "@/server/users";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { updateProfileSchema } from "@/lib/http/schemas";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    // getUserProfile selects public fields only — email and passwordHash
    // never leave the query layer, so there is nothing to strip here.
    const user = await getUserProfile(userId);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    return errorResponse("Get user error", error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  const { userId } = await params;

  if (session.user.id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { name, bio, avatarUrl } = await parseBody(request, updateProfileSchema);

    const user = await updateUserProfile(userId, { name, bio, avatarUrl });

    return NextResponse.json(user);
  } catch (error) {
    return errorResponse("Update user error", error);
  }
}
