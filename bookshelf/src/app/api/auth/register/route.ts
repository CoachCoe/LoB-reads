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
    // ONE bucket per request, chosen by whether the caller can be identified.
    // Never both — that was the first version of this and it was a site-wide
    // kill switch: the shared bucket was spent even when the per-client bound
    // had already refused the request, so one attacker's 200 refused attempts
    // locked out every other address for an hour. Measured. That is FLOW-2
    // again, which is the outage this code exists to avoid.
    //
    // When a client is identifiable the per-client limit IS the bound, and a
    // second shared one adds nothing but a common failure mode.
    //
    // The shared bucket covers only the unidentifiable case, which SEC-2 made
    // the default: clientRateLimitKey returns null when nothing trusted
    // appended X-Forwarded-For, and without a bound there the route had none at
    // all — unbounded account creation, each row seeded with three default
    // shelves in a transaction. It is far looser than the per-client limit
    // because an unidentified flood must not close the door at five requests
    // the way FLOW-2 did; a correctly configured deployment has no
    // unidentifiable callers at all, which deploy:verify asserts.
    const key = clientRateLimitKey(request, "register");
    const limit = key
      ? checkLimit(key, LIMITS.register)
      : checkLimit("register:unidentified", LIMITS.registerUnidentified);

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
