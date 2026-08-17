import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getFictionalWorldById, addMapToWorld } from "@/server/fictional-worlds";
import { validateImageFile, sanitizeFilename } from "@/lib/storage/file-validation";
import { checkLimit, LIMITS } from "@/lib/rate-limit";
import { putObject, isStorageConfigured } from "@/lib/storage/objects";

interface RouteParams {
  params: Promise<{ worldId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Uploads write to paid blob storage, so cap them per account.
    const limit = checkLimit(`upload:map:${user.id}`, LIMITS.upload);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many uploads. Please try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    const { worldId } = await params;

    // Check if the world exists
    const world = await getFictionalWorldById(worldId);
    if (!world) {
      return NextResponse.json(
        { error: "Fictional world not found" },
        { status: 404 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const title = formData.get("title") as string | null;
    const description = formData.get("description") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    if (!title || title.trim().length === 0) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

    // Validate file with magic byte checking
    const validation = await validateImageFile(file);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    if (!isStorageConfigured()) {
      console.error("Map upload attempted with S3_BUCKET unset");
      return NextResponse.json(
        { error: "Uploads are not available right now." },
        { status: 503 }
      );
    }

    // Store with a sanitized filename under a per-world prefix
    const safeName = sanitizeFilename(file.name);
    const key = `fictional-worlds/${worldId}/${Date.now()}-${safeName}`;
    const { url } = await putObject(key, file);

    // Create the map entry in the database
    const map = await addMapToWorld(worldId, user.id, {
      imageUrl: url,
      title: title.trim(),
      description: description?.trim() || null,
    });

    return NextResponse.json({ map });
  } catch (error) {
    console.error("Error uploading map image:", error);
    return NextResponse.json(
      { error: "Failed to upload map image" },
      { status: 500 }
    );
  }
}
