import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/session";
import { getUserAvatarUrl, updateUserProfile } from "@/server/users";
import { validateImageFile, sanitizeFilename } from "@/lib/file-validation";
import { putObject, deleteObjectByUrl, isStorageConfigured } from "@/lib/storage";
import { checkLimit, LIMITS } from "@/lib/rate-limit";

interface RouteParams {
  params: Promise<{ userId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = await params;

    // Ensure users can only update their own avatar
    if (user.id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Uploads write to paid blob storage, so cap them per account.
    const limit = checkLimit(`upload:avatar:${user.id}`, LIMITS.upload);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many uploads. Please try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!isStorageConfigured()) {
      console.error("Avatar upload attempted with S3_BUCKET unset");
      return NextResponse.json(
        { error: "Uploads are not available right now." },
        { status: 503 }
      );
    }

    // Validate file with magic byte checking
    const validation = await validateImageFile(file);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const previousAvatarUrl = await getUserAvatarUrl(userId);

    // Store with a sanitized filename under a per-user prefix
    const safeName = sanitizeFilename(file.name);
    const key = `avatars/${userId}/${Date.now()}-${safeName}`;
    const { url } = await putObject(key, file);

    await updateUserProfile(userId, { avatarUrl: url });

    // Replacing an avatar used to orphan the old object, which accumulated
    // storage cost forever. Best-effort: a failure here must not fail the
    // upload the user already completed. deleteObjectByUrl ignores URLs that
    // aren't ours, so an external DiceBear avatar is left alone.
    if (previousAvatarUrl) {
      try {
        await deleteObjectByUrl(previousAvatarUrl);
      } catch (storageError) {
        console.error("Failed to delete previous avatar:", storageError);
      }
    }

    return NextResponse.json({ url });
  } catch (error) {
    console.error("Error uploading avatar:", error);
    return NextResponse.json(
      { error: "Failed to upload avatar" },
      { status: 500 }
    );
  }
}
