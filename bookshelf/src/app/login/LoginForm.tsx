"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

// Validate callback URL to prevent open redirect attacks
function getSafeCallbackUrl(url: string | null): string {
  if (!url) return "/";

  // Only allow relative paths (starting with /)
  // Reject absolute URLs, protocol-relative URLs, and javascript: URLs
  if (
    url.startsWith("/") &&
    !url.startsWith("//") &&
    !url.toLowerCase().startsWith("/\\") &&
    !url.includes(":")
  ) {
    return url;
  }

  return "/";
}

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = getSafeCallbackUrl(searchParams.get("callbackUrl"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        // The server's message when it wrote one for the reader, otherwise the
        // generic line. authorize() throws "Too many sign-in attempts. Please
        // wait a few minutes and try again." — written specifically to tell
        // someone to stop and wait — and this discarded it, so a lockout was
        // reported as a wrong password. The reader then retried, and before the
        // SEC-4 fix each retry extended the window. NextAuth collapses
        // unrecognised failures to "CredentialsSignin", which is the case the
        // fallback covers.
        setError(
          result.error === "CredentialsSignin"
            ? "Invalid email or password"
            : result.error
        );
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">
          {error}
        </div>
      )}

      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        required
      />

      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Enter your password"
        required
      />

      <Button
        type="submit"
        className="w-full"
        isLoading={isLoading}
      >
        Sign In
      </Button>
    </form>
  );
}
