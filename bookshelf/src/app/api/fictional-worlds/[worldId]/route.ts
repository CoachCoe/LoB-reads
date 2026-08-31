import { NextRequest, NextResponse } from "next/server";
import { getFictionalWorldById } from "@/server/fictional-worlds";
import { errorResponse } from "@/lib/http/api";

interface RouteParams {
  params: Promise<{ worldId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { worldId } = await params;
    const world = await getFictionalWorldById(worldId);

    if (!world) {
      return NextResponse.json(
        { error: "Fictional world not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(world);
  } catch (error) {
    return errorResponse("Error fetching fictional world", error);
  }
}
