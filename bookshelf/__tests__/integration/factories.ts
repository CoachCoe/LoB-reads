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

export async function makeBook(overrides: { title?: string; pageCount?: number } = {}) {
  const n = unique();
  return prisma.book.create({
    data: {
      title: overrides.title ?? `Book ${n}`,
      author: "Test Author",
      pageCount: overrides.pageCount ?? 300,
    },
  });
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

export async function makeBookLocation(bookId: string, addedById: string) {
  return prisma.bookLocation.create({
    data: {
      bookId,
      addedById,
      name: "London",
      type: "setting",
      lat: 51.5074,
      lng: -0.1278,
    },
  });
}

export async function makeAuthorLocation(addedById: string) {
  const author = await prisma.author.create({
    data: { name: `Author ${unique()}` },
  });
  const location = await prisma.authorLocation.create({
    data: {
      authorId: author.id,
      addedById,
      name: "Oxford",
      type: "residence",
      lat: 51.752,
      lng: -1.2577,
    },
  });
  return { author, location };
}
