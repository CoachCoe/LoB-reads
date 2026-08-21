/**
 * @jest-environment node
 */

/**
 * keyFromUrl decides what a delete targets, so getting it wrong either leaks
 * storage (no delete) or deletes the wrong object. It must also refuse URLs
 * that aren't ours: a user's avatar is an external DiceBear URL until they
 * upload one, and that must never be treated as a deletable object.
 *
 * The Azure move added a failure mode S3 did not have. A CloudFront root
 * distribution served keys from the root of the origin; an Azure blob endpoint
 * puts the *container* in the path, so the base URL has a path component that
 * has to be stripped — and a same-origin URL in a different container is not
 * ours.
 */
describe("keyFromUrl", () => {
  const CDN = "https://lob-uploads.z01.azurefd.net";

  // Azurite's connection string, as the emulator publishes it. The account
  // name is in the endpoint path, which is why this shape is worth testing
  // rather than only the cloud one.
  const AZURITE =
    "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;" +
    "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;" +
    "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;";

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

  const withCdn = () =>
    loadWith({ CDN_URL: CDN, AZURE_STORAGE_ACCOUNT: "lobuploads" });

  it("extracts the key from a Front Door URL we issued", async () => {
    const { keyFromUrl } = await withCdn();
    expect(keyFromUrl(`${CDN}/avatars/user123/1700000000-pic.jpg`)).toBe(
      "avatars/user123/1700000000-pic.jpg"
    );
  });

  it("decodes percent-encoded characters in the key", async () => {
    const { keyFromUrl } = await withCdn();
    expect(keyFromUrl(`${CDN}/avatars/u1/my%20photo.jpg`)).toBe(
      "avatars/u1/my photo.jpg"
    );
  });

  it("returns null for a different origin", async () => {
    const { keyFromUrl } = await withCdn();
    // The default avatar assigned at registration.
    expect(
      keyFromUrl("https://api.dicebear.com/7.x/avataaars/svg?seed=Alice")
    ).toBeNull();
    // A leftover URL from a previous storage provider.
    expect(
      keyFromUrl("https://abc.public.blob.vercel-storage.com/avatars/x.jpg")
    ).toBeNull();
  });

  it("returns null for a malformed URL", async () => {
    const { keyFromUrl } = await withCdn();
    expect(keyFromUrl("not-a-url")).toBeNull();
    expect(keyFromUrl("")).toBeNull();
  });

  it("returns null for the CDN root with no key", async () => {
    const { keyFromUrl } = await withCdn();
    expect(keyFromUrl(`${CDN}/`)).toBeNull();
  });

  it("falls back to the account blob endpoint when CDN_URL is unset", async () => {
    const { keyFromUrl } = await loadWith({
      CDN_URL: undefined,
      AZURE_STORAGE_ACCOUNT: "lobuploads",
      AZURE_STORAGE_CONTAINER: "uploads",
    });
    // The container sits in the path, so this only works if the base path is
    // stripped rather than assumed empty.
    expect(
      keyFromUrl(
        "https://lobuploads.blob.core.windows.net/uploads/avatars/u1/a.jpg"
      )
    ).toBe("avatars/u1/a.jpg");
  });

  it("refuses a same-origin URL in a different container", async () => {
    // The path-based base makes this reachable in a way it was not on S3: the
    // origin matches, so an origin-only check would hand back a key and delete
    // someone else's blob.
    const { keyFromUrl } = await loadWith({
      CDN_URL: undefined,
      AZURE_STORAGE_ACCOUNT: "lobuploads",
      AZURE_STORAGE_CONTAINER: "uploads",
    });
    expect(
      keyFromUrl(
        "https://lobuploads.blob.core.windows.net/backups/avatars/u1/a.jpg"
      )
    ).toBeNull();
  });

  it("derives the endpoint from an Azurite connection string", async () => {
    const { isStorageConfigured, keyFromUrl } = await loadWith({
      CDN_URL: undefined,
      AZURE_STORAGE_ACCOUNT: undefined,
      AZURE_STORAGE_CONNECTION_STRING: AZURITE,
      AZURE_STORAGE_CONTAINER: "uploads",
      // No CDN in front of the emulator, so the container has to be declared
      // public for the files to be servable at all.
      AZURE_STORAGE_PUBLIC_CONTAINER: "true",
    });
    expect(isStorageConfigured()).toBe(true);
    expect(
      keyFromUrl("http://127.0.0.1:10000/devstoreaccount1/uploads/avatars/u1/a.jpg")
    ).toBe("avatars/u1/a.jpg");
  });

  it("reports unconfigured when credentials exist but nothing can serve the files", async () => {
    // The container is private, so an account with no CDN in front of it can
    // accept uploads and then serve 403 for every image. Reporting configured
    // here would turn a missing setting into silently broken pictures.
    const { isStorageConfigured } = await loadWith({
      CDN_URL: undefined,
      AZURE_STORAGE_ACCOUNT: "lobuploads",
      AZURE_STORAGE_PUBLIC_CONTAINER: undefined,
    });
    expect(isStorageConfigured()).toBe(false);
  });

  it("accepts a deliberately public container with no CDN", async () => {
    const { isStorageConfigured } = await loadWith({
      CDN_URL: undefined,
      AZURE_STORAGE_ACCOUNT: "lobuploads",
      AZURE_STORAGE_PUBLIC_CONTAINER: "true",
    });
    expect(isStorageConfigured()).toBe(true);
  });

  it("reports storage unconfigured when neither account nor connection string is set", async () => {
    const { isStorageConfigured, keyFromUrl } = await loadWith({
      CDN_URL: undefined,
      AZURE_STORAGE_ACCOUNT: undefined,
      AZURE_STORAGE_CONNECTION_STRING: undefined,
    });
    expect(isStorageConfigured()).toBe(false);
    expect(keyFromUrl(`${CDN}/avatars/u1/a.jpg`)).toBeNull();
  });
});
