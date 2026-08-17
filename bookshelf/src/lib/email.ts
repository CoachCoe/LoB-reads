/**
 * Email addresses are stored lowercased and trimmed, and every lookup must go
 * through this function. Postgres string equality is case-sensitive, so
 * without it "Reader@example.com" and "reader@example.com" are two different
 * accounts — and whichever casing you typed at sign-up is the only one that
 * can ever sign in.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
