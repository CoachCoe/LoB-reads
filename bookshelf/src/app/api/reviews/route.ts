import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createOrUpdateReview, getRecentReviews } from "@/server/reviews";

export async function GET() {
  try {
    const reviews = await getRecentReviews(20);
    return NextResponse.json(reviews);
  } catch (error) {
    console.error("Get reviews error:", error);
    return NextResponse.json({ error: "Failed to fetch reviews" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { bookId, rating, content } = await request.json();

    if (!bookId || !rating) {
      return NextResponse.json(
        { error: "Book ID and rating are required" },
        { status: 400 }
      );
    }

    if (rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "Rating must be between 1 and 5" },
        { status: 400 }
      );
    }

    const review = await createOrUpdateReview(
      session.user.id,
      bookId,
      rating,
      content
    );

    return NextResponse.json(review, { status: 201 });
  } catch (error) {
    console.error("Create review error:", error);
    return NextResponse.json({ error: "Failed to create review" }, { status: 500 });
  }
}
