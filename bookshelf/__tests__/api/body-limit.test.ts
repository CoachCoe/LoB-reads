/**
 * @jest-environment node
 */
import { z } from "zod";
import { parseBody, errorResponse, MAX_JSON_BODY_BYTES } from "@/lib/http/api";
import { PayloadTooLargeError } from "@/lib/http/errors";

/**
 * SEC-1: no JSON route had a body size limit.
 *
 * `parseBody` called `request.json()`, which buffers the entire body before Zod
 * or anything else can object. Eleven routes use it. `declaredBodyTooLarge`
 * existed for exactly this purpose — it was the previous audit's SEC-3 fix — but
 * had only ever been wired to the three *multipart* routes, so the JSON entry
 * point every other route shares was uncapped. There is no middleware, no
 * route-segment body config, and `serverActions.bodySizeLimit` does not apply to
 * route handlers.
 *
 * Twenty concurrent `POST /api/reviews` at 200 MB each is 4 GB of heap and an
 * OOM-killed container, from one signed-in account, on a route with no rate limit
 * either.
 *
 * The chunked case is the one worth the most: Content-Length is advisory and
 * absent on a chunked request, so a check that trusts it is not a limit. These
 * assertions send a body with no Content-Length at all.
 */

const schema = z.object({ content: z.string() });

/** A request whose body arrives in chunks, with no Content-Length header. */
function chunkedRequest(totalBytes: number, chunkBytes = 16 * 1024) {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, totalBytes - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size).fill(0x61)); // 'a'
    },
  });

  return new Request("http://localhost/api/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: stream,
    // Required by undici for a streaming body.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function jsonRequest(body: unknown, declaredLength?: number) {
  const text = JSON.stringify(body);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (declaredLength !== undefined) {
    headers["Content-Length"] = String(declaredLength);
  }
  return new Request("http://localhost/api/reviews", {
    method: "POST",
    headers,
    body: text,
  });
}

describe("parseBody size limit", () => {
  it("parses an ordinary body", async () => {
    const parsed = await parseBody(jsonRequest({ content: "A review." }), schema);
    expect(parsed.content).toBe("A review.");
  });

  it("accepts the largest legitimate body", async () => {
    // longText caps review content at 10,000 characters; the limit has to leave
    // room for that after JSON escaping.
    const parsed = await parseBody(
      jsonRequest({ content: "x".repeat(10_000) }),
      schema
    );
    expect(parsed.content).toHaveLength(10_000);
  });

  it("refuses a body over the limit that declares its size", async () => {
    await expect(
      parseBody(
        jsonRequest({ content: "x" }, MAX_JSON_BODY_BYTES + 1),
        schema
      )
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("refuses an oversized body that declares nothing at all", async () => {
    // The assertion that makes this a limit rather than a courtesy. A chunked
    // request carries no Content-Length, so the declared check cannot see it.
    await expect(
      parseBody(chunkedRequest(MAX_JSON_BODY_BYTES * 4), schema)
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("stops reading instead of buffering the whole oversized body", async () => {
    // 8 MB offered in 64 KB chunks. If the limit were enforced after the read,
    // every chunk would be pulled; the point is that it is not.
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 128) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(64 * 1024).fill(0x61));
      },
    });

    const request = new Request("http://localhost/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(parseBody(request, schema)).rejects.toBeInstanceOf(
      PayloadTooLargeError
    );

    // A couple of chunks, not 128. Exact count depends on undici's buffering,
    // so this asserts the order of magnitude rather than a specific number.
    expect(pulled).toBeLessThan(10);
  });

  it("still reports invalid JSON as a 400, not a size problem", async () => {
    const request = new Request("http://localhost/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not json",
    });

    await expect(parseBody(request, schema)).rejects.toThrow(
      "Request body must be valid JSON"
    );
  });

  it("still reports a schema violation as a schema violation", async () => {
    await expect(
      parseBody(jsonRequest({ content: 42 }), schema)
    ).rejects.toBeInstanceOf(Error);
  });

  it("honours a route-specific limit", async () => {
    await expect(
      parseBody(jsonRequest({ content: "x".repeat(2_000) }), schema, {
        maxBytes: 512,
      })
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
  });
});

describe("errorResponse maps the size failure", () => {
  it("answers 413, not 400 and not 500", async () => {
    // 413 rather than 400 because the caller is not malformed, it is too big —
    // and a client that retries a 400 unchanged should not retry this one.
    const response = errorResponse("test", new PayloadTooLargeError());
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: "Request body is too large",
    });
  });
});
