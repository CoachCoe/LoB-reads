/**
 * Verify the storage adapter against a real Azure Blob endpoint.
 *
 *   docker compose up -d azurite
 *   npm run storage:smoke
 *
 * The unit tests cover keyFromUrl's URL arithmetic, which is where the bugs
 * have been, but they mock the SDK — so nothing they assert would notice a
 * wrong upload call, a header that does not survive the round trip, or a
 * delete that silently no-ops. This does the real thing over HTTP.
 *
 * Point AZURE_STORAGE_CONNECTION_STRING at a real account and it verifies that
 * account instead, which is worth doing once after provisioning.
 */
// A bare `tsx` script does not read .env — only the Prisma CLI and Next do, and
// this script imports neither, so without this it reported the connection
// string unset no matter what was configured.
import "dotenv/config";
import { BlobServiceClient } from "@azure/storage-blob";
import {
  putObject,
  deleteObjectByUrl,
  isStorageConfigured,
  keyFromUrl,
} from "@/lib/storage/objects";

const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER = process.env.AZURE_STORAGE_CONTAINER ?? "uploads";

/**
 * Both postures are legitimate and the checks below differ between them, so
 * this reads the same setting the adapter does rather than assuming one.
 */
const PUBLIC_CONTAINER = process.env.AZURE_STORAGE_PUBLIC_CONTAINER === "true";

/** Every check that ran, so a failure names itself rather than just exiting. */
const results: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
}

async function main() {
  if (!CONNECTION_STRING) {
    throw new Error(
      "AZURE_STORAGE_CONNECTION_STRING is unset. For Azurite, see DEPLOYMENT.md."
    );
  }

  // The container is created by infrastructure in a real deployment; Azurite
  // starts empty, so this stands in for that step.
  const service = BlobServiceClient.fromConnectionString(CONNECTION_STRING);
  const created = await service
    .getContainerClient(CONTAINER)
    .createIfNotExists(PUBLIC_CONTAINER ? { access: "blob" } : {});
  check(
    "container exists",
    true,
    `${created.succeeded ? "created" : "already existed"}, ${
      PUBLIC_CONTAINER ? "public blob read" : "private"
    }`
  );

  check("isStorageConfigured", isStorageConfigured() === true);

  const key = `avatars/smoke-user/${Date.now()}-pic.txt`;
  const body = "hello from the storage smoke test";
  const { url } = await putObject(
    key,
    new File([body], "pic.txt", { type: "text/plain" })
  );
  check("putObject returned a URL", Boolean(url), url);

  check("keyFromUrl round-trips the key", keyFromUrl(url) === key, String(keyFromUrl(url)));

  // A private container must NOT serve an anonymous caller — a 200 there would
  // mean every upload is world-readable straight off the storage account. A
  // container declared public must serve one, or the images never render.
  const anonymous = await fetch(url);
  check(
    PUBLIC_CONTAINER
      ? "a public container serves anonymous reads"
      : "a private container refuses anonymous reads",
    anonymous.status === (PUBLIC_CONTAINER ? 200 : 403),
    `HTTP ${anonymous.status}`
  );

  // Content and headers are therefore verified through an authenticated read,
  // which is also how the CDN will fetch them.
  const blob = service.getContainerClient(CONTAINER).getBlockBlobClient(key);
  const downloaded = await blob.downloadToBuffer();
  check("the body survived the round trip", downloaded.toString() === body);

  const props = await blob.getProperties();
  check(
    "content-type was preserved",
    props.contentType?.startsWith("text/plain") === true,
    String(props.contentType)
  );
  check(
    "cache-control was set immutable",
    props.cacheControl === "public, max-age=31536000, immutable",
    String(props.cacheControl)
  );

  // A user's avatar is an external DiceBear URL until they upload one. Treating
  // that as a deletable object is the failure this guards.
  check(
    "a foreign URL is refused, not deleted",
    (await deleteObjectByUrl(
      "https://api.dicebear.com/7.x/avataaars/svg?seed=Alice"
    )) === false
  );

  check("deleteObjectByUrl reported success", (await deleteObjectByUrl(url)) === true);
  check("the object is gone", !(await blob.exists()));
}

main()
  .then(() => {
    for (const { name, ok, detail } of results) {
      process.stdout.write(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? `  (${detail})` : ""}\n`);
    }
    const failed = results.filter((r) => !r.ok).length;
    process.stdout.write(
      `\n${results.length - failed}/${results.length} checks passed\n`
    );
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((error) => {
    for (const { name, ok } of results) {
      process.stdout.write(`${ok ? "  ok  " : "  FAIL"} ${name}\n`);
    }
    process.stderr.write(`\nthrew: ${error.message}\n`);
    process.exit(1);
  });
