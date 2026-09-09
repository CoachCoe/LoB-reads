import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import Card, { CardContent, CardHeader } from "@/components/ui/Card";
import RegisterForm from "./RegisterForm";

export default function RegisterPage() {
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
            Join our community of readers!
          </p>
        </div>

        <Card>
          <CardHeader>
            <h1 className="text-xl font-semibold text-center text-[var(--foreground)]">
              Create Account
            </h1>
          </CardHeader>
          <CardContent>
            <Suspense
              fallback={
                <div className="h-72 animate-pulse bg-[var(--border-light)] rounded" />
              }
            >
              <RegisterForm />
            </Suspense>

            <div className="mt-6 text-center">
              <p className="text-sm text-[var(--foreground-secondary)]">
                Already have an account?{" "}
                <Link
                  href="/login"
                  className="text-[var(--color-primary-text)] hover:underline font-medium"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
