import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { getUserShelves, createShelf } from "@/server/shelves";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { createShelfSchema } from "@/lib/http/schemas";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return unauthorized();
  }

  try {
    const shelves = await getUserShelves(session.user.id);
    return NextResponse.json(shelves);
  } catch (error) {
    return errorResponse("Get shelves error", error);
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return unauthorized();
  }

  try {
    const { name } = await parseBody(request, createShelfSchema);
    const shelf = await createShelf(session.user.id, name);
    return NextResponse.json(shelf, { status: 201 });
  } catch (error) {
    return errorResponse("Create shelf error", error);
  }
}
