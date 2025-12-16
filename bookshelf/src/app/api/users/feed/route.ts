import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getActivityFeed } from "@/server/users";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const feed = await getActivityFeed(session.user.id);
    return NextResponse.json(feed);
  } catch (error) {
    console.error("Get feed error:", error);
    return NextResponse.json({ error: "Failed to fetch feed" }, { status: 500 });
  }
}
