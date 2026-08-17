import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import prisma from "./prisma";
import { normalizeEmail } from "./email";
import { checkLimit, LIMITS } from "./rate-limit";

/**
 * A real bcrypt hash of a value nothing can match, used only to equalise the
 * cost of the "no such user" path with the "wrong password" path.
 */
const DUMMY_PASSWORD_HASH =
  "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password required");
        }

        const email = normalizeEmail(credentials.email);

        // Throttle per account and per origin, so neither a single targeted
        // account nor a single host can be used for unbounded guessing.
        const forwardedFor = req?.headers?.["x-forwarded-for"];
        const ip =
          (typeof forwardedFor === "string"
            ? forwardedFor.split(",")[0].trim()
            : undefined) ?? "unknown";

        for (const key of [`login:email:${email}`, `login:ip:${ip}`]) {
          if (!checkLimit(key, LIMITS.login).allowed) {
            throw new Error(
              "Too many sign-in attempts. Please wait a few minutes and try again."
            );
          }
        }

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user) {
          // Spend comparable time on a missing user so response timing does
          // not reveal whether the address is registered.
          await bcrypt.compare(credentials.password, DUMMY_PASSWORD_HASH);
          throw new Error("Invalid email or password");
        }

        const isValidPassword = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );

        if (!isValidPassword) {
          throw new Error("Invalid email or password");
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.avatarUrl,
          isModerator: user.isModerator,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.isModerator = user.isModerator;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.isModerator = Boolean(token.isModerator);
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
