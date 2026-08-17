import { z } from "zod";

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
    .trim()
    .toLowerCase()
    .max(254, "Email address is too long") // RFC 5321
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

export const updateProfileSchema = z.object({
  name: shortText("Name").optional(),
  bio: optionalLongText,
  avatarUrl: z.url().max(2000).optional().nullable(),
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
