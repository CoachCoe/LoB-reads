import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { normalizeEmail } from "@/lib/email";
import { checkLimit, getClientIp, LIMITS } from "@/lib/rate-limit";

// Simple email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Every new account starts with these three; order is the display order. */
const DEFAULT_SHELVES = ["Want to Read", "Currently Reading", "Read"];

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254; // RFC 5321

// Password must be at least 8 characters with at least one letter and one number
function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 8) {
    return { valid: false, error: "Password must be at least 8 characters" };
  }
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, error: "Password must contain at least one letter" };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: "Password must contain at least one number" };
  }
  return { valid: true };
}

export async function POST(request: Request) {
  try {
    const limit = checkLimit(
      `register:${getClientIp(request)}`,
      LIMITS.register
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many sign-up attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    const body = await request.json();
    const { email, password, name } = body;

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      typeof name !== "string"
    ) {
      return NextResponse.json(
        { error: "Email, password, and name are required" },
        { status: 400 }
      );
    }

    const normalizedEmail = normalizeEmail(email);
    const trimmedName = name.trim();

    if (!normalizedEmail || !password || !trimmedName) {
      return NextResponse.json(
        { error: "Email, password, and name are required" },
        { status: 400 }
      );
    }

    // Validate email format
    if (
      !EMAIL_REGEX.test(normalizedEmail) ||
      normalizedEmail.length > MAX_EMAIL_LENGTH
    ) {
      return NextResponse.json(
        { error: "Please enter a valid email address" },
        { status: 400 }
      );
    }

    // Validate name length
    if (trimmedName.length < 2) {
      return NextResponse.json(
        { error: "Name must be at least 2 characters" },
        { status: 400 }
      );
    }

    if (trimmedName.length > MAX_NAME_LENGTH) {
      return NextResponse.json(
        { error: `Name must be ${MAX_NAME_LENGTH} characters or fewer` },
        { status: 400 }
      );
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return NextResponse.json(
        { error: passwordValidation.error },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 400 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create the user and their default shelves in one transaction. Creating
    // them separately could leave an account that exists but has no shelves,
    // which nothing repairs and which blocks re-registering the address.
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        name: trimmedName,
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(trimmedName)}`,
        shelves: {
          create: DEFAULT_SHELVES.map((shelfName) => ({
            name: shelfName,
            isDefault: true,
          })),
        },
      },
      select: { id: true, email: true, name: true },
    });

    return NextResponse.json(
      {
        message: "User created successfully",
        user,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "An error occurred during registration" },
      { status: 500 }
    );
  }
}
