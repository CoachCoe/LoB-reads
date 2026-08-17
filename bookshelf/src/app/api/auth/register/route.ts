import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { findUserByEmail, createUserWithDefaultShelves } from "@/server/users";
import { errorResponse, parseBody } from "@/lib/http/api";
import { registerSchema } from "@/lib/http/schemas";
import { checkLimit, getClientIp, LIMITS } from "@/lib/rate-limit";

/** Work factor for password hashing. */
const BCRYPT_ROUNDS = 10;

export async function POST(request: Request) {
  try {
    const limit = checkLimit(`register:${getClientIp(request)}`, LIMITS.register);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many sign-up attempts. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        }
      );
    }

    // The schema lowercases and trims the address. Postgres string equality is
    // case-sensitive, so without that, signing up as Reader@x.com would lock
    // you out of reader@x.com.
    const { email, password, name } = await parseBody(request, registerSchema);

    if (await findUserByEmail(email)) {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 400 }
      );
    }

    const user = await createUserWithDefaultShelves({
      email,
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      name,
      avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
    });

    return NextResponse.json(
      { message: "User created successfully", user },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse("Registration error", error);
  }
}
