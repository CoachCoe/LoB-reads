import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getCurrentUser } from "@/lib/session";
import { updateUserProfile } from "@/server/users";
import { validateImageFile, sanitizeFilename } from "@/lib/file-validation";

interface RouteParams {
  params: Promise<{ userId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = await params;

    // Ensure users can only update their own avatar
    if (user.id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

    // Upload to Vercel Blob with sanitized filename
    const safeName = sanitizeFilename(file.name);
    const filename = `avatars/${userId}/${Date.now()}-${safeName}`;
    const blob = await put(filename, file, {
      access: "public",
    });

    // Update user profile with new avatar URL
    await updateUserProfile(userId, { avatarUrl: blob.url });

    return NextResponse.json({ url: blob.url });
  } catch (error) {
    console.error("Error uploading avatar:", error);
    return NextResponse.json(
      { error: "Failed to upload avatar" },
      { status: 500 }
    );
  }
}
