import { Suspense } from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import Card, { CardContent, CardHeader } from "@/components/ui/Card";
import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#7047EB]/5 to-[#5fbd74]/5 py-12 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-amber-600">
            <BookOpen className="h-10 w-10" />
            <span className="text-3xl font-bold">Life on Books</span>
          </Link>
          <p className="mt-2 text-gray-600">Welcome back, reader!</p>
        </div>

        <Card>
          <CardHeader>
            <h1 className="text-xl font-semibold text-center">Sign In</h1>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<div className="h-48 animate-pulse bg-gray-100 rounded" />}>
              <LoginForm />
            </Suspense>

            <div className="mt-6 text-center">
              <p className="text-sm text-gray-600">
                Don&apos;t have an account?{" "}
                <Link
                  href="/register"
                  className="text-amber-600 hover:text-amber-700 font-medium"
                >
                  Sign up
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-sm text-gray-500">
          Demo: alice@example.com / password123
        </p>
      </div>
    </div>
  );
}
