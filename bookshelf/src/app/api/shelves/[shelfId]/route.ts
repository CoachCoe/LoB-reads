import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { deleteShelf } from "@/server/shelves";
import { errorResponse, unauthorized } from "@/lib/http/api";


export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ shelfId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  try {
    const { shelfId } = await params;
    await deleteShelf(shelfId, session.user.id);
    return NextResponse.json({ message: "Shelf deleted" });
  } catch (error) {
    return errorResponse("Delete shelf error", error);
  }
}
