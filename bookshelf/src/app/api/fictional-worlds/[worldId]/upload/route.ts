import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getCurrentUser } from "@/lib/session";
import { updateFictionalWorldMapImage, getFictionalWorldById } from "@/server/fictional-worlds";

interface RouteParams {
  params: Promise<{ worldId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image." },
        { status: 400 }
      );
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB." },
        { status: 400 }
      );
    }

    // Upload to Vercel Blob
    const filename = `fictional-worlds/${worldId}/${Date.now()}-${file.name}`;
    const blob = await put(filename, file, {
      access: "public",
    });

    // Update the fictional world with the new map image URL
    const updatedWorld = await updateFictionalWorldMapImage(worldId, blob.url);

    return NextResponse.json({
      url: blob.url,
      world: updatedWorld,
    });
  } catch (error) {
    console.error("Error uploading map image:", error);
    return NextResponse.json(
      { error: "Failed to upload map image" },
      { status: 500 }
    );
  }
}
