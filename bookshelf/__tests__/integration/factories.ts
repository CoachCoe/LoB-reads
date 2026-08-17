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

/** A catalog work, so shelf and review tests have something real to point at. */
export async function makeWork(
  overrides: { title?: string; pages?: number } = {}
) {
  const n = unique();
  const olKey = `OLT${n.replace(/[^0-9]/g, "").slice(-10)}W`;
  const title = overrides.title ?? `Work ${n}`;

  await prisma.$executeRaw`
    INSERT INTO catalog.works (ol_key, title, author_names, subjects, edition_count)
    VALUES (${olKey}, ${title}, 'Test Author', ARRAY['Fiction'], 1)
    ON CONFLICT (ol_key) DO NOTHING`;

  await prisma.$executeRaw`
    INSERT INTO catalog.editions (ol_key, work_key, title, number_of_pages)
    VALUES (${olKey + "E"}, ${olKey}, ${title}, ${overrides.pages ?? 300})
    ON CONFLICT (ol_key) DO NOTHING`;

  return { olKey, title };
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
