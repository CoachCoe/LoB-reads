import prisma from "@/lib/prisma";

function safeParseCoordinates(json: string): { lat: number; lng: number } {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed.lat === "number" && typeof parsed.lng === "number") {
      return parsed;
    }
    return { lat: 0, lng: 0 };
  } catch {
    return { lat: 0, lng: 0 };
  }
}

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

export async function getOrCreateAuthor(name: string): Promise<AuthorWithLocations> {
  let author = await prisma.author.findUnique({
    where: { name },
    include: {
      locations: {
        include: {
          addedBy: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!author) {
    author = await prisma.author.create({
      data: { name },
      include: {
        locations: {
          include: {
            addedBy: {
              select: { id: true, name: true },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
  }

  return {
    id: author.id,
    name: author.name,
    bio: author.bio,
    photoUrl: author.photoUrl,
    birthYear: author.birthYear,
    deathYear: author.deathYear,
    openLibraryId: author.openLibraryId,
    locations: author.locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      type: loc.type,
      description: loc.description,
      coordinates: safeParseCoordinates(loc.coordinates),
      yearStart: loc.yearStart,
      yearEnd: loc.yearEnd,
      addedBy: loc.addedBy,
      createdAt: loc.createdAt,
    })),
  };
}

export async function getAuthorByName(name: string): Promise<AuthorWithLocations | null> {
  const author = await prisma.author.findUnique({
    where: { name },
    include: {
      locations: {
        include: {
          addedBy: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!author) return null;

  return {
    id: author.id,
    name: author.name,
    bio: author.bio,
    photoUrl: author.photoUrl,
    birthYear: author.birthYear,
    deathYear: author.deathYear,
    openLibraryId: author.openLibraryId,
    locations: author.locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      type: loc.type,
      description: loc.description,
      coordinates: safeParseCoordinates(loc.coordinates),
      yearStart: loc.yearStart,
      yearEnd: loc.yearEnd,
      addedBy: loc.addedBy,
      createdAt: loc.createdAt,
    })),
  };
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
  // Get or create the author first
  const author = await getOrCreateAuthor(authorName);

  return prisma.authorLocation.create({
    data: {
      authorId: author.id,
      addedById: userId,
      name: data.name,
      type: data.type,
      description: data.description ?? null,
      coordinates: JSON.stringify(data.coordinates),
      yearStart: data.yearStart ?? null,
      yearEnd: data.yearEnd ?? null,
    },
    include: {
      addedBy: {
        select: { id: true, name: true },
      },
    },
  });
}

export async function deleteAuthorLocation(locationId: string, userId: string) {
  const location = await prisma.authorLocation.findUnique({
    where: { id: locationId },
    select: { addedById: true },
  });

  if (!location || location.addedById !== userId) {
    throw new Error("Not authorized to delete this location");
  }

  return prisma.authorLocation.delete({
    where: { id: locationId },
  });
}

export async function getAllAuthorLocationsForMap() {
  const locations = await prisma.authorLocation.findMany({
    include: {
      author: {
        select: {
          id: true,
          name: true,
          photoUrl: true,
        },
      },
    },
  });

  return locations.map((loc) => ({
    id: loc.id,
    name: loc.name,
    type: loc.type,
    coordinates: safeParseCoordinates(loc.coordinates),
    author: loc.author,
  }));
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
