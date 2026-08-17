/**
 * Third-party enrichment sources.
 *
 * Open Library's descriptions are missing or one-line on most records. These
 * fill the gap — but the results are a *cache*, not data we own:
 *
 *   - every value is written to catalog.enrichment with a non-null expires_at
 *   - nothing is ever written to catalog.works or catalog.editions
 *   - the source is recorded, so any one of them can be purged in one statement
 *
 * That is a licensing constraint, not a preference. Google's terms treat
 * responses as cached content; presenting them as our own, or building a
 * redistributable export containing them, is not permitted.
 */

export interface EnrichmentTarget {
  entityType: "work" | "edition";
  entityKey: string;
  title: string;
  authorNames: string | null;
  isbn13: string | null;
}

export interface EnrichmentResult {
  /** Null means "asked, and there is genuinely nothing" — a cacheable miss. */
  value: string | null;
  /** How long the answer may be trusted. */
  ttlDays: number;
}

export interface EnrichmentSource {
  readonly name: string;
  /** Requests per second this source tolerates. */
  readonly ratePerSecond: number;
  fetchDescription(target: EnrichmentTarget): Promise<EnrichmentResult>;
}

/** Raised when a source asks us to slow down; the worker backs off. */
export class RateLimitedError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "RateLimitedError";
  }
}

/**
 * Google Books.
 *
 * An API key is effectively required. Keyless requests are answered with 429
 * from any shared or busy address — verified against the live endpoint, three
 * spaced attempts, all rate-limited. Without GOOGLE_BOOKS_API_KEY set the
 * worker will make almost no progress.
 */
export class GoogleBooksSource implements EnrichmentSource {
  readonly name = "google_books";
  /** Undocumented and unstable; kept well below anything observed to fail. */
  readonly ratePerSecond = 5;

  constructor(private readonly apiKey = process.env.GOOGLE_BOOKS_API_KEY) {}

  async fetchDescription(target: EnrichmentTarget): Promise<EnrichmentResult> {
    const query = target.isbn13
      ? `isbn:${target.isbn13}`
      : `intitle:${quote(target.title)}${
          target.authorNames ? `+inauthor:${quote(firstAuthor(target.authorNames))}` : ""
        }`;

    const url = new URL("https://www.googleapis.com/books/v1/volumes");
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", "1");
    url.searchParams.set("country", "US");
    if (this.apiKey) url.searchParams.set("key", this.apiKey);

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 429 || response.status === 403) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new RateLimitedError(
        `Google Books returned ${response.status}${
          this.apiKey ? "" : " — no GOOGLE_BOOKS_API_KEY is set"
        }`,
        Number.isFinite(retryAfter) ? retryAfter : undefined
      );
    }

    if (!response.ok) {
      throw new Error(`Google Books returned ${response.status}`);
    }

    const body = (await response.json()) as {
      items?: { volumeInfo?: { description?: string } }[];
    };

    const description = body.items?.[0]?.volumeInfo?.description?.trim();

    return {
      // A confirmed absence is worth caching — otherwise every pass re-asks
      // for the same books that will never have a description.
      value: description && description.length > 0 ? description : null,
      // 30 days, per the licensing note above.
      ttlDays: 30,
    };
  }
}

const quote = (value: string) => `"${value.replace(/"/g, "")}"`;
const firstAuthor = (names: string) => names.split(",")[0].trim();
