import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import Card, { CardContent, CardHeader } from "@/components/ui/Card";
import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)] py-12 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-3 justify-center"
          >
            <Image
              src="/logo.png"
              alt="Life on Books"
              width={120}
              height={48}
              className="h-12 w-auto logo-themed"
            />
            <span className="text-3xl font-bold text-[var(--foreground)]">Life on Books</span>
          </Link>
          <p className="mt-2 text-[var(--foreground-secondary)]">
            Welcome back, reader!
          </p>
        </div>

        <Card>
          <CardHeader>
            <h1 className="text-xl font-semibold text-center text-[var(--foreground)]">
              Sign In
            </h1>
          </CardHeader>
          <CardContent>
            <Suspense
              fallback={
                <div className="h-48 animate-pulse bg-[var(--border-light)] rounded" />
              }
            >
              <LoginForm />
            </Suspense>

            <div className="mt-6 text-center">
              <p className="text-sm text-[var(--foreground-secondary)]">
                Don&apos;t have an account?{" "}
                <Link
                  href="/register"
                  className="text-[var(--color-primary-text)] hover:underline font-medium"
                >
                  Sign up
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>

        {/*
          Development only. prisma/seed.ts hashes a known password for
          alice@example.com, and this rendered it unconditionally on a page
          every visitor reaches. README documents `npm run db:seed` and the seed
          refuses to run in production as of this change, but the credential
          should not be printed regardless. FLOW-3.
        */}
        {process.env.NODE_ENV !== "production" && (
          <p className="mt-4 text-center text-sm text-[var(--foreground-secondary)]">
            Demo: alice@example.com / password123
          </p>
        )}
      </div>
    </div>
  );
}
