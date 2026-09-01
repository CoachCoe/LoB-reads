import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { getWorkShelfStatus } from "@/server/shelves";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workKey: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { workKey } = await params;
    const status = await getWorkShelfStatus(session.user.id, workKey);
    return NextResponse.json(status);
  } catch (error) {
    console.error("Get work shelf status error:", error);
    return NextResponse.json(
      { error: "Failed to get shelf status" },
      { status: 500 }
    );
  }
}
