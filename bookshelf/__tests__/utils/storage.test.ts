/**
 * @jest-environment node
 */

/**
 * keyFromUrl decides what a delete targets, so getting it wrong either leaks
 * storage (no delete) or deletes the wrong object. It must also refuse URLs
 * that aren't ours: a user's avatar is an external DiceBear URL until they
 * upload one, and that must never be treated as a deletable object.
 */
describe("keyFromUrl", () => {
  const CDN = "https://d111111abcdef8.cloudfront.net";

  // Assigning undefined to process.env stores the string "undefined", so keys
  // must be deleted rather than set.
  const loadWith = async (env: Record<string, string | undefined>) => {
    jest.resetModules();
    const previous = { ...process.env };

    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    const mod = await import("@/lib/storage/objects");

    for (const key of Object.keys(env)) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
    return mod;
  };

  it("extracts the key from a CloudFront URL we issued", async () => {
    const { keyFromUrl } = await loadWith({
      CDN_URL: CDN,
      S3_BUCKET: "bucket",
    });
    expect(keyFromUrl(`${CDN}/avatars/user123/1700000000-pic.jpg`)).toBe(
      "avatars/user123/1700000000-pic.jpg"
    );
  });

  it("decodes percent-encoded characters in the key", async () => {
    const { keyFromUrl } = await loadWith({
      CDN_URL: CDN,
      S3_BUCKET: "bucket",
    });
    expect(keyFromUrl(`${CDN}/avatars/u1/my%20photo.jpg`)).toBe(
      "avatars/u1/my photo.jpg"
    );
  });

  it("returns null for a different origin", async () => {
    const { keyFromUrl } = await loadWith({
      CDN_URL: CDN,
      S3_BUCKET: "bucket",
    });
    // The default avatar assigned at registration.
    expect(
      keyFromUrl("https://api.dicebear.com/7.x/avataaars/svg?seed=Alice")
    ).toBeNull();
    // A leftover URL from the previous storage provider.
    expect(
      keyFromUrl("https://abc.public.blob.vercel-storage.com/avatars/x.jpg")
    ).toBeNull();
  });

  it("returns null for a malformed URL", async () => {
    const { keyFromUrl } = await loadWith({
      CDN_URL: CDN,
      S3_BUCKET: "bucket",
    });
    expect(keyFromUrl("not-a-url")).toBeNull();
    expect(keyFromUrl("")).toBeNull();
  });

  it("returns null for the CDN root with no key", async () => {
    const { keyFromUrl } = await loadWith({
      CDN_URL: CDN,
      S3_BUCKET: "bucket",
    });
    expect(keyFromUrl(`${CDN}/`)).toBeNull();
  });

  it("falls back to the direct S3 endpoint when CDN_URL is unset", async () => {
    const { keyFromUrl } = await loadWith({
      CDN_URL: undefined,
      S3_BUCKET: "my-bucket",
      AWS_REGION: "eu-west-2",
    });
    expect(
      keyFromUrl("https://my-bucket.s3.eu-west-2.amazonaws.com/avatars/u1/a.jpg")
    ).toBe("avatars/u1/a.jpg");
  });

  it("reports storage unconfigured when the bucket is unset", async () => {
    const { isStorageConfigured, keyFromUrl } = await loadWith({
      CDN_URL: undefined,
      S3_BUCKET: undefined,
    });
    expect(isStorageConfigured()).toBe(false);
    expect(keyFromUrl(`${CDN}/avatars/u1/a.jpg`)).toBeNull();
  });
});
