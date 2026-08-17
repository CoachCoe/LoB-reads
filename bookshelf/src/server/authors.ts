import prisma from "@/lib/prisma";
import { AuthorizationError, NotFoundError } from "@/lib/http/errors";

export interface AuthorWithLocations {
  id: string;
  name: string;
  bio: string | null;
  photoUrl: string | null;
  birthYear: number | null;
  deathYear: number | null;
  openLibraryId: string | null;
  locations: AuthorLocationData[];
}

export interface AuthorLocationData {
  id: string;
  name: string;
  type: string;
  description: string | null;
  coordinates: { lat: number; lng: number };
  yearStart: number | null;
  yearEnd: number | null;
  addedBy: {
    id: string;
    name: string;
  };
  createdAt: Date;
}

const locationInclude = {
  addedBy: {
    select: { id: true, name: true },
  },
} as const;

type AuthorLocationRow = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  lat: number;
  lng: number;
  yearStart: number | null;
  yearEnd: number | null;
  addedBy: { id: string; name: string };
  createdAt: Date;
};

/**
 * Coordinates are stored as two Float columns and presented to callers as a
 * `{ lat, lng }` pair, which is what the map components already expect.
 */
function toLocationData(loc: AuthorLocationRow): AuthorLocationData {
  return {
    id: loc.id,
    name: loc.name,
    type: loc.type,
    description: loc.description,
    coordinates: { lat: loc.lat, lng: loc.lng },
    yearStart: loc.yearStart,
    yearEnd: loc.yearEnd,
    addedBy: loc.addedBy,
    createdAt: loc.createdAt,
  };
}

function toAuthorWithLocations(author: {
  id: string;
  name: string;
  bio: string | null;
  photoUrl: string | null;
  birthYear: number | null;
  deathYear: number | null;
  openLibraryId: string | null;
  locations: AuthorLocationRow[];
}): AuthorWithLocations {
  return {
    id: author.id,
    name: author.name,
    bio: author.bio,
    photoUrl: author.photoUrl,
    birthYear: author.birthYear,
    deathYear: author.deathYear,
    openLibraryId: author.openLibraryId,
    locations: author.locations.map(toLocationData),
  };
}

/** Authors are created lazily the first time someone contributes a location. */
async function getOrCreateAuthor(name: string): Promise<AuthorWithLocations> {
  const existing = await prisma.author.findUnique({
    where: { name },
    include: {
      locations: { include: locationInclude, orderBy: { createdAt: "desc" } },
    },
  });

  if (existing) return toAuthorWithLocations(existing);

  const created = await prisma.author.create({
    data: { name },
    include: {
      locations: { include: locationInclude, orderBy: { createdAt: "desc" } },
    },
  });

  return toAuthorWithLocations(created);
}

export async function getAuthorByName(
  name: string
): Promise<AuthorWithLocations | null> {
  const author = await prisma.author.findUnique({
    where: { name },
    include: {
      locations: { include: locationInclude, orderBy: { createdAt: "desc" } },
    },
  });

  return author ? toAuthorWithLocations(author) : null;
}

export async function addAuthorLocation(
  authorName: string,
  userId: string,
  data: {
    name: string;
    type: string;
    description?: string;
    coordinates: { lat: number; lng: number };
    yearStart?: number;
    yearEnd?: number;
  }
) {
  const author = await getOrCreateAuthor(authorName);

  return prisma.authorLocation.create({
    data: {
      authorId: author.id,
      addedById: userId,
      name: data.name,
      type: data.type,
      description: data.description ?? null,
      lat: data.coordinates.lat,
      lng: data.coordinates.lng,
      yearStart: data.yearStart ?? null,
      yearEnd: data.yearEnd ?? null,
    },
    include: locationInclude,
  });
}

export async function deleteAuthorLocation(locationId: string, userId: string) {
  const location = await prisma.authorLocation.findUnique({
    where: { id: locationId },
    select: { addedById: true },
  });

  if (!location) {
    throw new NotFoundError("Location not found");
  }

  if (location.addedById !== userId) {
    throw new AuthorizationError(
      "You can only remove locations you contributed"
    );
  }

  return prisma.authorLocation.delete({
    where: { id: locationId },
  });
}

export async function getBooksForAuthor(authorName: string) {
  return prisma.book.findMany({
    where: { author: authorName },
    select: {
      id: true,
      title: true,
      coverUrl: true,
      publishedDate: true,
    },
    orderBy: { publishedDate: "asc" },
  });
}
