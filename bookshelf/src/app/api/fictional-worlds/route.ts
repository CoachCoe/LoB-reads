import { NextRequest, NextResponse } from "next/server";
import { getAllFictionalWorlds, createFictionalWorld } from "@/server/fictional-worlds";
import { getCurrentUser } from "@/lib/auth/session";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { createFictionalWorldSchema } from "@/lib/http/schemas";

export async function GET() {
  try {
    const worlds = await getAllFictionalWorlds();
    return NextResponse.json(worlds);
  } catch (error) {
    return errorResponse("Error fetching fictional worlds", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return unauthorized();
    }

    const { name, description } = await parseBody(
      request,
      createFictionalWorldSchema
    );

    const world = await createFictionalWorld(name, description ?? undefined);
    return NextResponse.json(world, { status: 201 });
  } catch (error) {
    return errorResponse("Error creating fictional world", error);
  }
}
