import { existsSync, readFileSync, readdirSync } from "node:fs";
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
const SCHEMAS_FILE = path.join("src", "lib", "http", "schemas.ts");

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

/**
 * Split a route module into its exported handlers.
 *
 * Everything after the last handler's `export async function` — module-level
 * helpers, usually — lands in that handler's block. That makes the check
 * slightly permissive at the tail and never falsely strict, which is the right
 * direction for a mechanical convention.
 */
function handlersOf(source: string): { method: string; body: string }[] {
  const marker = /export async function ([A-Z]+)\s*\(/g;
  const starts: { method: string; index: number }[] = [];

  for (const match of source.matchAll(marker)) {
    starts.push({ method: match[1], index: match.index ?? 0 });
  }

  return starts.map((start, i) => ({
    method: start.method,
    body: source.slice(start.index, starts[i + 1]?.index ?? source.length),
  }));
}

/**
 * Source with comments removed, so a checker reads code rather than prose.
 *
 * Line comments are only stripped when they start the line, so a `https://`
 * inside a string survives. Enough for the mechanical checks here, and it means
 * a doc comment naming an example URL is not mistaken for a call.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
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

  /**
   * Per HANDLER, not per file.
   *
   * This used to test the whole source for `getCurrentUser|getServerSession`,
   * which answers "does this file mention a session helper anywhere" — so a
   * route file with two mutating handlers passed if either one of them checked,
   * and a new unauthenticated handler added beside an authenticated one was
   * invisible. Six of the route files export more than one mutating handler.
   */
  it("requires authentication in every mutating handler, not just somewhere in the file", () => {
    const offenders = routeFiles().flatMap((file) => {
      if (PUBLIC_MUTATION_ROUTES.includes(file)) return [];

      return handlersOf(read(file))
        .filter(({ method }) => /^(POST|PATCH|PUT|DELETE)$/.test(method))
        .filter(({ body }) => !/getCurrentUser|getServerSession/.test(body))
        .map(({ method }) => `${file}: ${method}`);
    });

    expect(offenders).toEqual([]);
  });

  it("finds more than one handler in the files that have more than one", () => {
    // Guards the splitter itself: if handlersOf ever returned one block per
    // file, the check above would silently weaken back to what it replaced.
    const follow = handlersOf(
      read(path.join(API_DIR, "users/[userId]/follow/route.ts"))
    );
    expect(follow.map((h) => h.method).sort()).toEqual(["DELETE", "POST"]);
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

  it("keeps database access out of pages and layouts too", () => {
    // The check above walked only src/app/api, so a server COMPONENT importing
    // prisma was invisible to it — and one did: src/app/(main)/settings/page.tsx
    // queried prisma.user directly, contradicting README.md ("All database
    // access lives here, never in a route") and ARCHITECTURE.md, which names
    // exactly one documented exception and not this one.
    const pageFiles = walk("src/app", (f) =>
      /(page|layout)\.tsx?$/.test(f)
    ).sort();

    expect(pageFiles.length).toBeGreaterThan(10);

    const offenders = pageFiles.filter((file) =>
      /from "@\/lib\/prisma"/.test(read(file))
    );

    expect(offenders).toEqual([]);
  });
});

/**
 * Client components must not pull the server layer into the browser bundle.
 *
 * `ShelfSection` value-imported `coverUrl` from `@/server/catalog`, whose module
 * scope constructs a PrismaClient and evaluated `Prisma.sql` at import time. The
 * browser build of Prisma throws from `Prisma.sql`, so /my-books shipped a chunk
 * that threw before the component was defined and the page never hydrated. A
 * green typecheck, a green lint, 371 green tests and a successful build all
 * missed it, because nothing renders a client component in a browser here.
 *
 * `import type` is fine — it is erased before the bundler sees it.
 */
describe("client/server boundary", () => {
  const clientFiles = (): string[] =>
    walk("src", (f) => /\.tsx?$/.test(f)).filter((file) =>
      /^\s*["']use client["']/m.test(read(file))
    );

  it("finds the client components (guards against a broken scan)", () => {
    expect(clientFiles().length).toBeGreaterThan(5);
  });

  it("never value-imports the server layer into a client component", () => {
    // Matches `import { x } from "@/server/..."` but not `import type { ... }`,
    // and not `import { type X }`-only specifier lists.
    const VALUE_IMPORT =
      /import\s+(?!type\b)([^;]*?)\s+from\s+["'](@\/server\/[^"']+|@\/lib\/prisma)["']/g;

    const offenders = clientFiles().flatMap((file) => {
      const source = read(file);
      return [...source.matchAll(VALUE_IMPORT)]
        .filter(([, specifiers]) => {
          // A brace list whose every member is `type X` is still type-only.
          const inner = specifiers.match(/\{([\s\S]*)\}/)?.[1];
          if (!inner) return true;
          return inner
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .some((s) => !s.startsWith("type "));
        })
        .map(([match]) => `${file}: ${match.replace(/\s+/g, " ")}`);
    });

    expect(offenders).toEqual([]);
  });
});

/**
 * Every URL a client component fetches must resolve to a route that exports
 * that method.
 *
 * The M3 repoint moved the shelf routes and left the components calling the old
 * paths, so shelving silently 404'd for three milestones. core-loop.test.ts was
 * written to stop that recurring, and it half does: it asserts the components
 * are mounted, but it hand-types the URLs and bodies it sends to the handlers —
 * so it verifies that the routes accept what the TEST sends. Pointing
 * AddToShelfButton at `/api/shelves/${id}/books` again would not fail it.
 *
 * This reads the URLs out of the components instead, and covers every component
 * rather than the one page core-loop looks at (PRD R7).
 */
describe("client calls resolve to routes that exist", () => {
  /** Route directories as segment lists: shelves/[shelfId]/works -> [...]. */
  const routeSegments = (): { segments: string[]; file: string }[] =>
    routeFiles().map((file) => ({
      file,
      segments: path
        .relative(API_DIR, path.dirname(file))
        .split(path.sep)
        .filter(Boolean),
    }));

  /** `/api/shelves/${shelf.id}/works?x=1` -> ["shelves", "*", "works"]. */
  const urlSegments = (url: string): string[] | null => {
    const withoutQuery = url.split("?")[0];
    if (!withoutQuery.startsWith("/api/")) return null;
    return withoutQuery
      .slice("/api/".length)
      .split("/")
      .filter(Boolean)
      .map((segment) => (segment.includes("${") ? "*" : segment));
  };

  /**
   * How specifically a route matches a URL, or null for no match.
   *
   * The rules matter more than they look. An interpolated segment (`*`) may
   * fill a dynamic route segment but NOT a literal one — without that,
   * `/api/fictional-worlds/maps/${mapId}` "matches"
   * `fictional-worlds/[worldId]/upload`. And a catch-all swallows the rest,
   * which is why `/api/auth/register` would otherwise resolve to
   * `auth/[...nextauth]`. The score is the number of literal segments matched,
   * so the most specific route wins.
   */
  const specificity = (url: string[], route: string[]): number | null => {
    let score = 0;
    let i = 0;

    for (; i < route.length; i++) {
      const segment = route[i];

      if (segment.startsWith("[...")) {
        // Catch-all: consumes whatever is left, and never wins on specificity.
        return i <= url.length ? score : null;
      }

      if (i >= url.length) return null;

      if (segment.startsWith("[")) continue; // dynamic: any single segment
      if (url[i] !== segment) return null; // literal: must match exactly
      score++;
    }

    return i === url.length ? score : null;
  };

  const routeFor = (
    url: string[],
    routes: { segments: string[]; file: string }[]
  ) =>
    routes
      .map((route) => ({ route, score: specificity(url, route.segments) }))
      .filter((c): c is { route: typeof routes[number]; score: number } =>
        c.score !== null
      )
      .sort((a, b) => b.score - a.score)[0]?.route;

  /** Every fetch("...") / fetch(`...`) in the app, with the methods it names. */
  const clientCalls = (): { file: string; url: string; methods: string[] }[] => {
    const calls: { file: string; url: string; methods: string[] }[] = [];

    for (const file of walk("src", (f) => /\.tsx?$/.test(f))) {
      const source = read(file);
      const pattern = /fetch\(\s*[`"']([^`"']*)[`"']\s*(?:,\s*\{([\s\S]*?)\})?\s*\)/g;

      for (const match of source.matchAll(pattern)) {
        const url = match[1];
        if (!url.startsWith("/api/")) continue;
        const options = match[2] ?? "";
        const methods = [...options.matchAll(/method:\s*[^,}]*?["'](\w+)["']/g)].map(
          (m) => m[1]
        );
        // A fetch with no method is a GET.
        calls.push({ file, url, methods: methods.length ? methods : ["GET"] });
      }
    }

    return calls;
  };

  it("finds the client calls (guards against a broken scan)", () => {
    expect(clientCalls().length).toBeGreaterThan(10);
  });

  /**
   * Every `/api/...` literal in the app, not only those written inline in a
   * fetch call — a component may build its URLs in a lookup table, and those
   * still have to resolve.
   */
  const apiUrlLiterals = (): { file: string; url: string }[] => {
    const found: { file: string; url: string }[] = [];

    for (const file of walk("src", (f) => /\.tsx?$/.test(f))) {
      if (file.startsWith(API_DIR)) continue; // the routes themselves
      for (const match of withoutComments(read(file)).matchAll(
        /[`"'](\/api\/[^`"'\s]*)[`"']/g
      )) {
        found.push({ file, url: match[1] });
      }
    }

    return found;
  };

  it("never names an API path with no matching route", () => {
    const routes = routeSegments();

    const offenders = apiUrlLiterals().filter(({ url }) => {
      const segments = urlSegments(url);
      return segments !== null && !routeFor(segments, routes);
    });

    expect(offenders.map((o) => `${o.file}: ${o.url}`)).toEqual([]);
  });

  it("never calls a method the matching route does not export", () => {
    const routes = routeSegments();

    const offenders = clientCalls().flatMap(({ file, url, methods }) => {
      const segments = urlSegments(url);
      if (!segments) return [];

      const route = routeFor(segments, routes);
      if (!route) return []; // reported by the test above

      const exported = [
        ...read(route.file).matchAll(/export async function ([A-Z]+)\s*\(/g),
      ].map((m) => m[1]);

      return methods
        .filter((method) => !exported.includes(method))
        .map((method) => `${file}: ${method} ${url}`);
    });

    expect(offenders).toEqual([]);
  });
});

/**
 * Pages a reader with no account must be able to open.
 *
 * PRD section 2: the browser "arrives with no account, follows a subject or an
 * author. Must never hit a login wall to look at a book or a public shelf." /map
 * is on this list by decision (audit OQ-4): it renders only
 * community-contributed data, and it was behind `redirect("/login")`, which is
 * not "buried" — it is a wall.
 *
 * Listed rather than derived, so making a public page private is a visible
 * choice rather than a silent one.
 */
describe("public pages stay public", () => {
  const PUBLIC_PAGES = [
    "src/app/(main)/page.tsx",
    "src/app/(main)/about/page.tsx",
    "src/app/(main)/map/page.tsx",
    "src/app/(main)/search/page.tsx",
    "src/app/(main)/work/[olKey]/page.tsx",
    "src/app/(main)/author/[authorName]/page.tsx",
    "src/app/(main)/shelf/[shelfId]/page.tsx",
    "src/app/(main)/user/[userId]/page.tsx",
  ];

  it("every listed page exists", () => {
    const missing = PUBLIC_PAGES.filter((file) => !existsSync(file));
    expect(missing).toEqual([]);
  });

  it("none of them redirects to the login page", () => {
    const offenders = PUBLIC_PAGES.filter((file) =>
      /redirect\(\s*[`"']\/login/.test(withoutComments(read(file)))
    );

    expect(offenders).toEqual([]);
  });
});

/**
 * Gold is a fill, not a text colour.
 *
 * `#D4A017` measures 2.28:1 on the light page background — it fails AA for text
 * by a wide margin, and it was being used for links, button labels, chip text
 * and the Wrapped nav item. `--color-primary-text` exists for that job
 * (4.85:1 light, 10.79:1 dark); `--color-primary` stays for fills, filled stars
 * and focus rings.
 *
 * The allowlist below is decorative icons plus StarRating's fill. Each is a
 * glyph beside its own text label, not something anyone has to read, so AA text
 * contrast does not apply — but they are listed rather than pattern-matched, so
 * adding a tenth gold text colour is a deliberate edit to this file.
 */
describe("gold is never a text colour", () => {
  const ALLOWED = [
    // Decorative icons, each adjacent to a text label that carries the meaning.
    "src/app/(main)/my-books/page.tsx",
    "src/app/(main)/about/page.tsx",
    "src/components/catalog/WorkLocationsSection.tsx",
    "src/components/locations/LocationsPanel.tsx",
    "src/components/import/ImportReviewList.tsx",
    // The filled star itself. `text-` sets the SVG stroke beside `fill-`.
    "src/components/ui/StarRating.tsx",
  ];

  it("finds the stylesheet tokens it depends on", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain("--color-primary-text");
    expect(css).toContain("--color-primary-contrast");
  });

  it("uses --color-primary-text for text, outside the decorative allowlist", () => {
    const offenders = walk("src", (f) => /\.tsx?$/.test(f))
      .filter((file) => !ALLOWED.includes(file))
      .filter((file) => /text-\[#D4A017\]/.test(withoutComments(read(file))));

    expect(offenders).toEqual([]);
  });

  it("never puts a white label on a gold fill", () => {
    // 2.38:1. A gold button whose own label could not be read.
    //
    // `from-` as well as `bg-`: Avatar painted its initials on
    // `bg-gradient-to-br from-[#D4A017] to-[#D4A017]` — a gradient between one
    // colour and itself — which is a gold fill by any other name, and the
    // earlier version of this check looked only for `bg-` and waved it through.
    const offenders = walk("src", (f) => /\.tsx?$/.test(f)).filter((file) =>
      /(?:bg|from)-\[#D4A017\][^"'`]*text-white/.test(withoutComments(read(file)))
    );

    expect(offenders).toEqual([]);
  });
});

/**
 * Every grey text colour is paired with a dark-mode variant.
 *
 * The app themes by `.dark` on `<html>`, and the dominant pattern in these
 * components is an explicit pair — `text-gray-500 dark:text-gray-400` — used on
 * 167 lines. An unpaired grey therefore is not a style choice, it is a line
 * somebody forgot: the light value survives into dark mode, where it is being
 * read against #141414 instead of #ffffff.
 *
 * Fourteen of them had accumulated, and the worst was not subtle. StarRating's
 * empty stars were `fill-gray-200`, which is 1.24:1 on white — properly quiet —
 * and 14.88:1 on the dark card, i.e. brighter than the gold `#D4A017` of a
 * filled star. Every rating in dark mode showed five lit stars. That is wrong
 * data on the screen, not a cosmetic complaint, and it survived a dark-mode
 * sweep, a design review and a token contrast suite, because all three looked
 * at the stylesheet and this lives in a className.
 *
 * Checked per string literal rather than per line, so a className broken across
 * several lines is judged whole. A `dark:` anywhere in one literal satisfies the
 * check for every grey in it — permissive at the edges and never falsely strict,
 * which is the right direction for a mechanical rule.
 */
describe("grey text is never unpaired", () => {
  const GREY = /\b(?:text|fill|stroke)-(?:gray|slate|zinc|neutral)-\d{2,3}\b/;
  /** Double-quoted, single-quoted and template literals. */
  const LITERAL = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g;

  /** Literals naming a grey text colour with no dark-mode variant. */
  function unpaired(source: string): string[] {
    return (withoutComments(source).match(LITERAL) ?? []).filter(
      (literal) => GREY.test(literal) && !literal.includes("dark:")
    );
  }

  it("catches an unpaired grey, and passes a paired one", () => {
    // Without this, a typo in the regexes above makes the check below vacuous
    // and the suite goes green on exactly the bug it exists to stop.
    expect(unpaired('<p className="text-sm text-gray-500" />')).toHaveLength(1);
    expect(
      unpaired('<p className="text-gray-500 dark:text-gray-400" />')
    ).toHaveLength(0);
    // A grey inside a comment is prose, not code.
    expect(unpaired('// was text-gray-200 once\n')).toHaveLength(0);
  });

  it("pairs every grey text colour in src", () => {
    const offenders = walk("src", (f) => /\.tsx?$/.test(f)).flatMap((file) =>
      unpaired(read(file)).map((literal) => `${file}: ${literal.trim()}`)
    );

    expect(offenders).toEqual([]);
  });
});

/**
 * Read paths over contributed tables are bounded.
 *
 * Anyone signed in can grow `app.work_locations`, `app.author_locations` and
 * `app.fictional_worlds`, and the public /map read them with no `take` at all —
 * two unbounded `findMany`s plus a hydration over every distinct work key,
 * serialised whole into the RSC payload. FLOW-22 fixed the same shape on the
 * author page and the map was not covered, which is the argument for a
 * mechanical check rather than another careful reading.
 *
 * Listed by function rather than pattern-matched: most `findMany` calls in this
 * codebase are scoped by a unique key and want no limit, so a blanket rule would
 * be noise. These five are the ones whose input is other people's contributions.
 */
describe("contributed read paths are bounded", () => {
  const MUST_BE_BOUNDED: [file: string, fn: string][] = [
    ["src/server/map.ts", "getMappedWorkLocations"],
    ["src/server/map.ts", "getMappedAuthorLocations"],
    ["src/server/fictional-worlds.ts", "getAllFictionalWorlds"],
    ["src/server/work-locations.ts", "getWorkLocations"],
    ["src/server/authors.ts", "getAuthorLocations"],
  ];

  /** The body of an exported function, to its closing brace at column 0. */
  function bodyOf(source: string, fn: string): string {
    const start = source.indexOf(`export async function ${fn}(`);
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("\n}", start);
    return source.slice(start, end === -1 ? undefined : end);
  }

  it("finds the function it is checking", () => {
    // So a rename turns into a failure here rather than a silently vacuous pass.
    expect(bodyOf(read("src/server/map.ts"), "getMappedWorkLocations")).toContain(
      "workLocation.findMany"
    );
  });

  it.each(MUST_BE_BOUNDED)("%s: %s caps what it reads", (file, fn) => {
    expect(bodyOf(read(file), fn)).toContain("take:");
  });
});

describe("schema conventions", () => {
  it("uses every schema it defines", () => {
    // updateProfileSchema was written and left unwired for several commits,
    // leaving one route unvalidated while looking covered.
    const source = read(SCHEMAS_FILE);
    const defined = [...source.matchAll(/export const (\w+Schema)\b/g)].map(
      (m) => m[1]
    );

    expect(defined.length).toBeGreaterThan(5);

    const consumers = walk("src", (f) => /\.tsx?$/.test(f))
      .filter((f: string) => f !== SCHEMAS_FILE)
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
