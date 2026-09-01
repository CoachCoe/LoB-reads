import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { findUserByEmail, createUserWithDefaultShelves } from "@/server/users";
import { errorResponse, parseBody } from "@/lib/http/api";
import { registerSchema } from "@/lib/http/schemas";
import { checkLimit, clientRateLimitKey, LIMITS } from "@/lib/rate-limit";

/** Work factor for password hashing. */
const BCRYPT_ROUNDS = 10;

export async function POST(request: Request) {
  try {
    // Only when the client is identifiable. getClientIp returns null if nothing
    // trusted appended X-Forwarded-For, and keying every request on one shared
    // bucket meant five sign-ups an hour for the entire deployment — closing
    // registration site-wide from five requests. See SEC-3 and FLOW-2.
    const key = clientRateLimitKey(request, "register");
    if (key) {
      const limit = checkLimit(key, LIMITS.register);
      if (!limit.allowed) {
        return NextResponse.json(
          { error: "Too many sign-up attempts. Please try again later." },
          {
            status: 429,
            headers: { "Retry-After": String(limit.retryAfterSeconds) },
          }
        );
      }
    }

    // The schema lowercases and trims the address. Postgres string equality is
    // case-sensitive, so without that, signing up as Reader@x.com would lock
    // you out of reader@x.com.
    const { email, password, name } = await parseBody(request, registerSchema);

    // This tells an unauthenticated caller whether an address is registered,
    // which the sign-in path deliberately avoids doing (options.ts spends a
    // dummy bcrypt compare so response timing does not reveal it). Audit SEC-12.
    //
    // Kept, as a recorded decision (OQ-6). The alternative is answering
    // identically either way, which without email verification means a reader
    // who has simply forgotten they have an account gets a success message and
    // no account — a real and frequent harm against a modest disclosure. What
    // made the trade acceptable is that the 5/hour cap above is now real: it was
    // keyed on the leftmost X-Forwarded-For element, which the client controls,
    // so it could be defeated by incrementing a header (SEC-2, fixed).
    //
    // Revisit if email verification lands, which removes the objection.
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
