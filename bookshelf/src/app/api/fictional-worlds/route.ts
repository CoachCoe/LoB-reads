import { NextRequest, NextResponse } from "next/server";
import { getAllFictionalWorlds, createFictionalWorld } from "@/server/fictional-worlds";
import { getCurrentUser } from "@/lib/session";

export async function GET() {
  try {
    const worlds = await getAllFictionalWorlds();
    return NextResponse.json(worlds);
  } catch (error) {
    console.error("Error fetching fictional worlds:", error);
    return NextResponse.json(
      { error: "Failed to fetch fictional worlds" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, description } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const world = await createFictionalWorld(name, description);
    return NextResponse.json(world, { status: 201 });
  } catch (error) {
    console.error("Error creating fictional world:", error);
    return NextResponse.json(
      { error: "Failed to create fictional world" },
      { status: 500 }
    );
  }
}
