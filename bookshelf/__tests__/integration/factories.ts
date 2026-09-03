import { prisma } from "./setup";

/**
 * Minimal builders so tests read as intent rather than setup. Each returns the
 * created row; anything a test does not care about gets a sensible default.
 */

let counter = 0;
const unique = () => `${Date.now()}-${counter++}`;

export async function makeUser(
  overrides: { name?: string; email?: string; isModerator?: boolean } = {}
) {
  const n = unique();
  return prisma.user.create({
    data: {
      email: overrides.email ?? `user-${n}@example.com`,
      passwordHash: "not-a-real-hash",
      name: overrides.name ?? `User ${n}`,
      isModerator: overrides.isModerator ?? false,
    },
  });
}

/** A user with the three default shelves, as registration would create them. */
export async function makeUserWithShelves(
  overrides: Parameters<typeof makeUser>[0] = {}
) {
  const n = unique();
  return prisma.user.create({
    data: {
      email: overrides.email ?? `user-${n}@example.com`,
      passwordHash: "not-a-real-hash",
      name: overrides.name ?? `User ${n}`,
      isModerator: overrides.isModerator ?? false,
      shelves: {
        create: [
          { name: "Want to Read", isDefault: true },
          { name: "Currently Reading", isDefault: true },
          { name: "Read", isDefault: true },
        ],
      },
    },
    include: { shelves: true },
  });
}

/**
 * A catalog work, so shelf and review tests have something real to point at.
 *
 * `author`, `subjects` and `coverId` exist for the tests that read them back —
 * Wrapped ranks authors and genres, and renders a cover for a top-rated book.
 *
 * The conflict clauses UPDATE rather than DO NOTHING. `unique()` is only as
 * unique as the low digits of `Date.now()` plus a counter that restarts per
 * test FILE, so two files can generate the same key; under DO NOTHING the
 * second caller silently inherited the first one's title, author and page
 * count, and a test asserting on those would have been reading another
 * suite's fixture. Cleanup is by the OLT prefix, which is unchanged.
 */
export async function makeWork(
  overrides: {
    title?: string;
    pages?: number;
    author?: string | null;
    subjects?: string[];
    coverId?: number;
  } = {}
) {
  const n = unique();
  const olKey = `OLT${n.replace(/[^0-9]/g, "").slice(-10)}W`;
  const title = overrides.title ?? `Work ${n}`;
  const editionKey = olKey + "E";
  const author = overrides.author === undefined ? "Test Author" : overrides.author;
  const subjects = overrides.subjects ?? ["Fiction"];

  await prisma.$executeRaw`
    INSERT INTO catalog.works (ol_key, title, author_names, subjects, edition_count, cover_edition_key)
    VALUES (${olKey}, ${title}, ${author}, ${subjects}, 1,
            ${overrides.coverId != null ? editionKey : null})
    ON CONFLICT (ol_key) DO UPDATE SET
      title = EXCLUDED.title,
      author_names = EXCLUDED.author_names,
      subjects = EXCLUDED.subjects,
      cover_edition_key = EXCLUDED.cover_edition_key`;

  await prisma.$executeRaw`
    INSERT INTO catalog.editions (ol_key, work_key, title, number_of_pages, cover_id)
    VALUES (${editionKey}, ${olKey}, ${title}, ${overrides.pages ?? 300},
            ${overrides.coverId ?? null})
    ON CONFLICT (ol_key) DO UPDATE SET
      title = EXCLUDED.title,
      number_of_pages = EXCLUDED.number_of_pages,
      cover_id = EXCLUDED.cover_id`;

  return { olKey, editionKey, title };
}

export async function makeShelf(
  userId: string,
  overrides: { name?: string; isDefault?: boolean } = {}
) {
  return prisma.shelf.create({
    data: {
      userId,
      name: overrides.name ?? `Shelf ${unique()}`,
      isDefault: overrides.isDefault ?? false,
    },
  });
}

export async function makeFictionalWorld(name?: string) {
  return prisma.fictionalWorld.create({
    data: { name: name ?? `World ${unique()}` },
  });
}

export async function makeMap(worldId: string, addedById: string) {
  return prisma.fictionalWorldMap.create({
    data: {
      fictionalWorldId: worldId,
      addedById,
      imageUrl: `https://cdn.example/${unique()}.png`,
      title: "A map",
    },
  });
}

export async function makeWorkLocation(workKey: string, addedById: string) {
  return prisma.workLocation.create({
    data: {
      workKey,
      addedById,
      name: "London",
      type: "setting",
      lat: 51.5074,
      lng: -0.1278,
    },
  });
}

export async function makeAuthorLocation(addedById: string) {
  const authorKey = `OLT${unique().replace(/[^0-9]/g, "").slice(-9)}A`;
  await prisma.$executeRaw`
    INSERT INTO catalog.authors (ol_key, name) VALUES (${authorKey}, ${"Author " + authorKey})
    ON CONFLICT (ol_key) DO NOTHING`;

  const location = await prisma.authorLocation.create({
    data: {
      authorKey,
      addedById,
      name: "Oxford",
      type: "residence",
      lat: 51.752,
      lng: -1.2577,
    },
  });
  return { authorKey, location };
}
