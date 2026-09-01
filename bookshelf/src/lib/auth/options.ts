import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { normalizeEmail } from "@/lib/auth/email";
import { checkLimit, clientIpFromHeaders, LIMITS, refundHit } from "@/lib/rate-limit";

/**
 * A real bcrypt hash of a value nothing can match, used only to equalise the
 * cost of the "no such user" path with the "wrong password" path.
 */
/**
 * How long a token may carry `isModerator` before it is re-read. One query per
 * active session per five minutes, against a revocation that otherwise never
 * took effect.
 */
const MODERATOR_REVALIDATE_MS = 5 * 60_000;

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
        //
        // Goes through clientIpFromHeaders rather than re-deriving the address:
        // this copy had the same leftmost-element bug, and two implementations
        // of "which hop do we trust" is one too many.
        const headerValue = (name: string) => {
          const value = req?.headers?.[name];
          return typeof value === "string" ? value : undefined;
        };
        // The platform header is passed here too, so sign-in is identified the
        // same way every other route is. NextAuth hands us a plain object rather
        // than a Headers, hence the lookup helper.
        const platformHeader = process.env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
        const ip = clientIpFromHeaders(
          headerValue("x-forwarded-for"),
          headerValue("x-real-ip"),
          platformHeader ? headerValue(platformHeader) : undefined
        );

        // Per account always; per origin only when the origin is known.
        //
        // `ip` is null when nothing in front appended X-Forwarded-For and no
        // x-real-ip arrived. It used to be the string "unknown", which put every
        // request on ONE bucket: ten attempts from a single attacker then
        // refused sign-in to every user of the site for fifteen minutes, and
        // forty requests an hour sustained that indefinitely. A per-account
        // limit with no origin limit is weaker against spraying; a global bucket
        // is a self-service outage. See SEC-3 and FLOW-2.
        const keys = [`login:email:${email}`];
        if (ip) keys.push(`login:ip:${ip}`);

        // Recorded on arrival, refunded if the password turns out to be right.
        //
        // Counting every attempt meant the victim's own correct password spent
        // the budget the attacker was draining, so a known address could be
        // locked out permanently — and FLOW-1 meant they were told their
        // password was wrong (SEC-4).
        //
        // The refund, rather than a check-without-recording call: checkLimit is
        // a single synchronous check-and-record, so it bounds concurrency.
        // Splitting it into a read, an await on bcrypt, and a later write let a
        // hundred parallel attempts all see an empty bucket and all proceed —
        // turning a limit of ten into a hundred guesses per window. Recording
        // first and giving it back is the only ordering that has both
        // properties.
        for (const key of keys) {
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

        // Correct credentials: give the attempt back, so a reader signing in
        // never spends the budget that exists to stop someone guessing at them.
        for (const key of keys) refundHit(key);

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
      // Sign-in: the row was just read, so trust it and stamp the time.
      if (user) {
        token.id = user.id;
        token.isModerator = user.isModerator;
        token.checkedAt = Date.now();
        return token;
      }

      // Every later request carries the token and nothing else. Without this
      // branch `isModerator` was whatever it was at sign-in, for as long as the
      // token lived — and NextAuth re-encodes with a fresh expiry on every
      // session read, so for an active user "as long as the token lived" was
      // indefinitely. A demoted moderator kept deleting other people's maps and
      // their blobs; a promoted one gained nothing until they signed out; a
      // deleted account still authenticated.
      const checkedAt = typeof token.checkedAt === "number" ? token.checkedAt : 0;
      if (Date.now() - checkedAt < MODERATOR_REVALIDATE_MS) return token;

      const fresh = token.id
        ? await prisma.user.findUnique({
            where: { id: token.id },
            select: { isModerator: true },
          })
        : null;

      if (!fresh) {
        // The account is gone. Blank the id rather than throwing: every route
        // guards on `!session?.user?.id` / `!user?.id`, so this becomes a 401
        // instead of a 500 or a session that authenticates a deleted user.
        token.id = "";
        token.isModerator = false;
        return token;
      }

      token.isModerator = fresh.isModerator;
      token.checkedAt = Date.now();
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
    // NextAuth's default is 30 days, and it re-encodes with a fresh expiry on
    // every session read — so an active session never expired at all.
    maxAge: 24 * 60 * 60,
  },
  secret: process.env.NEXTAUTH_SECRET,
};
