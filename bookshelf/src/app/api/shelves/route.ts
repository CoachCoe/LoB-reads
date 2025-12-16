import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserShelves, createShelf } from "@/server/shelves";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const shelves = await getUserShelves(session.user.id);
    return NextResponse.json(shelves);
  } catch (error) {
    console.error("Get shelves error:", error);
    return NextResponse.json({ error: "Failed to fetch shelves" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { name } = await request.json();

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const shelf = await createShelf(session.user.id, name);
    return NextResponse.json(shelf, { status: 201 });
  } catch (error) {
    console.error("Create shelf error:", error);
    return NextResponse.json({ error: "Failed to create shelf" }, { status: 500 });
  }
}
