import { z } from "zod";
import { normalizeEmail } from "@/lib/auth/email";

/**
 * Request shapes for the API routes.
 *
 * These exist because validation was previously hand-rolled per route and had
 * drifted: ratings were range-checked but not required to be integers, page
 * numbers were unbounded (negatives were accepted and stored), free text had
 * no length limit at all, and coordinates were validated in one location route
 * but not the other.
 */

/** Postgres text columns are unbounded; these are product limits, not DB ones. */
const SHORT_TEXT = 200;
const LONG_TEXT = 10_000;

const shortText = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(SHORT_TEXT, `${label} must be ${SHORT_TEXT} characters or fewer`);

const optionalLongText = z
  .string()
  .trim()
  .max(LONG_TEXT, `Must be ${LONG_TEXT} characters or fewer`)
  .optional()
  .nullable();

export const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/**
 * Registration. The password rules are stricter than a length check because
 * this is the only credential the account has.
 */
export const registerSchema = z.object({
  email: z
    .string()
    // email.ts states that "every lookup must go through this function"; the
    // registration path re-implemented it as .trim().toLowerCase() instead. They
    // agreed, but the stated invariant did not hold, and a change to the
    // canonical helper would not have reached the write path.
    .transform(normalizeEmail)
    .pipe(z.string().max(254, "Email address is too long")) // RFC 5321
    .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
      message: "Please enter a valid email address",
    }),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200, "Password is too long")
    .refine((v) => /[a-zA-Z]/.test(v), {
      message: "Password must contain at least one letter",
    })
    .refine((v) => /[0-9]/.test(v), {
      message: "Password must contain at least one number",
    }),
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be 100 characters or fewer"),
});

export const createShelfSchema = z.object({
  name: shortText("Shelf name"),
});

/** Work keys are Open Library ids: OL45804W. */
const workKey = z
  .string()
  .trim()
  .min(1, "Work key is required")
  .max(40)
  .regex(/^OL[0-9A-Za-z]+W$/, "Not a valid work key");

export const shelfWorkSchema = z.object({ workKey });

export const createReviewSchema = z.object({
  workKey,
  // Was range-checked but not constrained to an integer, so 3.7 reached the
  // database column and failed there instead of here.
  rating: z.int().min(1).max(5),
  content: optionalLongText,
});

export const updateProgressSchema = z
  .object({
    workKey,
    editionKey: z.string().trim().max(40).optional(),
    action: z.enum(["start", "finish"]).optional(),
    // Was entirely unvalidated: negative page numbers were accepted.
    currentPage: z.int().min(0).max(100_000).optional(),
  })
  .refine(
    (value) => value.action !== undefined || value.currentPage !== undefined,
    { message: "Either action or currentPage is required" }
  );

/**
 * Hosts an avatar may point at, besides our own storage origin.
 *
 * `api.dicebear.com` is the generator the app itself uses — at registration
 * (`api/auth/register/route.ts`) and from the settings form.
 */
const AVATAR_HOSTS = ["api.dicebear.com"];

/**
 * An avatar URL, constrained to somewhere we control.
 *
 * `z.url()` on its own is not a scheme check: verified against the installed
 * zod, it accepts `javascript:alert(1)`, `data:text/html,...` and `vbscript:`.
 * The value is rendered straight into an `<img src>` by `Avatar.tsx` with
 * `unoptimized`, which skips the image optimizer and therefore bypasses
 * `next.config.ts`'s `remotePatterns` altogether — so nothing else was
 * constraining it but the CSP.
 *
 * It also allowed a reader to set their own `avatarUrl` to another user's
 * stored blob URL and have their next upload delete that blob, since the
 * deletion only checked the origin. The upload route now scopes deletion to the
 * caller's own prefix as well; this is the other half.
 */
const avatarUrlSchema = z
  .url()
  .max(2000)
  .refine((value) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return false;
    }

    // Our own storage origin, whatever scheme it is configured with — the local
    // blob emulator is served over http.
    const configured = process.env.CDN_URL;
    if (configured) {
      try {
        if (parsed.origin === new URL(configured).origin) return true;
      } catch {
        // A malformed CDN_URL is a deployment problem, not this value's.
      }
    }

    return parsed.protocol === "https:" && AVATAR_HOSTS.includes(parsed.hostname);
  }, "Avatar URL must point at our own storage or the avatar generator");

export const updateProfileSchema = z.object({
  name: shortText("Name").optional(),
  bio: optionalLongText,
  avatarUrl: avatarUrlSchema.optional().nullable(),
});

export const createFictionalWorldSchema = z.object({
  name: shortText("Name"),
  description: optionalLongText,
});

export const updateMapSchema = z.object({
  title: shortText("Title"),
  description: optionalLongText,
});

export const createWorkLocationSchema = z.object({
  name: shortText("Location name"),
  type: z.enum(["setting", "mentioned", "inspired_by"]),
  description: optionalLongText,
  coordinates: coordinatesSchema.optional().nullable(),
  isFictional: z.boolean().optional(),
  fictionalWorldId: z.string().min(1).optional().nullable(),
});

export const createAuthorLocationSchema = z.object({
  name: shortText("Location name"),
  type: z.enum(["birthplace", "residence", "worked", "death"]),
  description: optionalLongText,
  coordinates: coordinatesSchema,
  yearStart: z.int().min(-3000).max(3000).optional().nullable(),
  yearEnd: z.int().min(-3000).max(3000).optional().nullable(),
});

/** Confirming a fuzzy import match: the reader picked one of the candidates. */
export const confirmImportRowSchema = z.object({ workKey });
