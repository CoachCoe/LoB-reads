import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Conventions enforced mechanically, because every one of these was violated
 * at least once and found by a human reading the code rather than by a test.
 *
 * These check source text rather than behaviour. That is a blunt instrument,
 * but it is the right one here: the failure mode is a new route quietly
 * skipping a shared safeguard, which no behavioural test of existing routes
 * would ever notice.
 */

const API_DIR = "src/app/api";

/** Recursively collect files matching a predicate. */
function walk(dir: string, match: (file: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, match);
    return match(full) ? [full] : [];
  });
}

function routeFiles(): string[] {
  return walk(API_DIR, (f) => f.endsWith("route.ts")).sort();
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

/** Registration is intentionally unauthenticated; everything else is not. */
const PUBLIC_MUTATION_ROUTES = [
  path.join(API_DIR, "auth/register/route.ts"),
  path.join(API_DIR, "auth/[...nextauth]/route.ts"),
];

describe("API route conventions", () => {
  it("finds the route files (guards against a broken glob)", () => {
    // If this ever returns nothing, every test below would vacuously pass.
    expect(routeFiles().length).toBeGreaterThan(15);
  });

  it("parses request bodies through a schema, never raw JSON", () => {
    // Bodies parsed by hand drift: length caps get forgotten, integers are not
    // checked, and each route ends up with slightly different rules.
    const offenders = routeFiles().filter((file) => {
      const source = read(file);
      return source.includes("request.json()") && !source.includes("parseBody");
    });

    expect(offenders).toEqual([]);
  });

  it("requires authentication on every mutating route", () => {
    const offenders = routeFiles().filter((file) => {
      if (PUBLIC_MUTATION_ROUTES.includes(file)) return false;
      const source = read(file);
      const mutates = /export async function (POST|PATCH|PUT|DELETE)/.test(source);
      if (!mutates) return false;
      return !/getCurrentUser|getServerSession/.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it("never puts a raw error message into an error response", () => {
    // Prisma errors name constraints and columns. errorResponse logs the
    // detail and returns a fixed string instead.
    //
    // Narrowed to the actual leak shape — `{ error: <the caught error> }` —
    // rather than any mention of error.message. The Goodreads importer
    // legitimately reports per-row reasons in its *result* payload, which is
    // the user's own file failing to parse, not an internal fault.
    const LEAK = /error:\s*error instanceof Error\s*\?\s*error\.message/;

    const offenders = routeFiles().filter((file) => LEAK.test(read(file)));

    expect(offenders).toEqual([]);
  });

  it("keeps database access out of route handlers", () => {
    // Routes stay thin; queries live in src/server. Importing prisma directly
    // into a route is how that boundary erodes.
    const offenders = routeFiles().filter((file) =>
      /from "@\/lib\/prisma"/.test(read(file))
    );

    expect(offenders).toEqual([]);
  });
});

describe("schema conventions", () => {
  it("uses every schema it defines", () => {
    // updateProfileSchema was written and left unwired for several commits,
    // leaving one route unvalidated while looking covered.
    const source = read("src/lib/schemas.ts");
    const defined = [...source.matchAll(/export const (\w+Schema)\b/g)].map(
      (m) => m[1]
    );

    expect(defined.length).toBeGreaterThan(5);

    const consumers = walk("src", (f) => /\.tsx?$/.test(f))
      .filter((f: string) => !f.endsWith(path.join("lib", "schemas.ts")))
      .map(read)
      .join("\n");

    const unused = defined.filter(
      (name) =>
        !consumers.includes(name) &&
        // Composed into other schemas rather than used by a route.
        !new RegExp(`${name}[.\\s),]`).test(source.replace(/export const \w+Schema/g, ""))
    );

    expect(unused).toEqual([]);
  });
});
