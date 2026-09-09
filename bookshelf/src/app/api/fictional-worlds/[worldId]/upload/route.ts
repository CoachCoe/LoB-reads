import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getFictionalWorldById, addMapToWorld } from "@/server/fictional-worlds";
import {
  validateImageFile,
  sanitizeFilename,
  MAX_FILE_SIZE,
} from "@/lib/storage/file-validation";
import { updateMapSchema } from "@/lib/http/schemas";
import {
  declaredBodyTooLarge,
  errorResponse,
  payloadTooLarge,
  unauthorized,
} from "@/lib/http/api";
import { checkLimit, LIMITS } from "@/lib/rate-limit";
import { putObject, isStorageConfigured } from "@/lib/storage/objects";

interface RouteParams {
  params: Promise<{ worldId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return unauthorized();
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

    // Before formData(), which buffers the entire body.
    if (declaredBodyTooLarge(request, MAX_FILE_SIZE)) {
      return payloadTooLarge("File too large. Maximum size is 5MB.");
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

    // Parsed with the schema the EDIT path uses, rather than a hand-rolled
    // emptiness check. These fields arrive as multipart, so they never went
    // through parseBody and never met SHORT_TEXT/LONG_TEXT — while
    // updateMapSchema applied both. A map could therefore be created with a
    // title no edit could ever save, and the columns are unbounded `text`, so
    // ~5MB of title could be stored and then serialised to every anonymous
    // caller of GET /api/fictional-worlds.
    const parsed = updateMapSchema.safeParse({
      title,
      description: description ?? null,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid map details" },
        { status: 400 }
      );
    }

    // Validate file with magic byte checking
    const validation = await validateImageFile(file);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    if (!isStorageConfigured()) {
      console.error("Map upload attempted with object storage unconfigured");
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
      title: parsed.data.title,
      description: parsed.data.description?.trim() || null,
    });

    return NextResponse.json({ map });
  } catch (error) {
    return errorResponse("Error uploading map image", error);
  }
}
