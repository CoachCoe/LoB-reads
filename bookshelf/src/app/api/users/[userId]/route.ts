import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { updateUserProfile } from "@/server/users";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { updateProfileSchema } from "@/lib/http/schemas";


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
