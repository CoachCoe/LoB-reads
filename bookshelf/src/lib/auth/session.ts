import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";

export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  return session?.user;
}

/**
 * The session for a page that requires one, or a redirect to sign in.
 *
 * Guards on `user?.id` rather than `user`, and exists so that guard is written
 * once. `options.ts` blanks the id for an account that no longer exists rather
 * than throwing, and its comment states the contract that makes that safe:
 *
 *   "every route guards on `!session?.user?.id` / `!user?.id`, so this becomes
 *    a 401 instead of a 500 or a session that authenticates a deleted user."
 *
 * That held for all 19 API handlers and for /import/[sessionId]. It did not
 * hold for /feed, /my-books, /settings, /wrapped or /wrapped/projections, which
 * each guarded on `!user` — and `session.user` stays truthy after the blanking,
 * because only the id is cleared. So the guard passed, the page queried with
 * `userId: ""`, and a deleted account got a working-looking empty library:
 * "Your library is empty", "Following 0 readers", "0 books".
 *
 * Five copies of a one-line guard is how one of them ends up different, so
 * there is one copy now. The narrowed return type is the other half: a caller
 * cannot reach `user.id` without having gone through the check.
 */
export async function requireUser(callbackUrl?: string) {
  const user = await getCurrentUser();

  if (!user?.id) {
    redirect(
      callbackUrl
        ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
        : "/login"
    );
  }

  return user;
}
