import { NextRequest, NextResponse } from "next/server";
import { put, del } from "@vercel/blob";
import { getCurrentUser } from "@/lib/session";
import { getUserAvatarUrl, updateUserProfile } from "@/server/users";
import { validateImageFile, sanitizeFilename } from "@/lib/file-validation";
import { checkLimit, LIMITS } from "@/lib/rate-limit";

interface RouteParams {
  params: Promise<{ userId: string }>;
}

/** Only blobs we uploaded are ours to delete. */
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

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

    // Validate file with magic byte checking
    const validation = await validateImageFile(file);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const previousAvatarUrl = await getUserAvatarUrl(userId);

    // Upload to Vercel Blob with sanitized filename
    const safeName = sanitizeFilename(file.name);
    const filename = `avatars/${userId}/${Date.now()}-${safeName}`;
    const blob = await put(filename, file, {
      access: "public",
    });

    // Update user profile with new avatar URL
    await updateUserProfile(userId, { avatarUrl: blob.url });

    // Replacing an avatar used to orphan the old blob, which accumulated
    // storage cost forever. Best-effort: a failure here must not fail the
    // upload the user already completed.
    if (previousAvatarUrl && isOwnedBlob(previousAvatarUrl)) {
      try {
        await del(previousAvatarUrl);
      } catch (blobError) {
        console.error("Failed to delete previous avatar blob:", blobError);
      }
    }

    return NextResponse.json({ url: blob.url });
  } catch (error) {
    console.error("Error uploading avatar:", error);
    return NextResponse.json(
      { error: "Failed to upload avatar" },
      { status: 500 }
    );
  }
}

function isOwnedBlob(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(BLOB_HOST_SUFFIX);
  } catch {
    return false;
  }
}
