import prisma from "@/lib/prisma";

export interface BookLocation {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  settingLocation: string | null;
  settingCoordinates: { lat: number; lng: number } | null;
  authorOrigin: string | null;
  authorOriginCoordinates: { lat: number; lng: number } | null;
  isFictional: boolean;
  fictionalWorldName: string | null;
}

// Crowdsourced location for the map
export interface CrowdsourcedLocation {
  id: string;
  name: string;
  type: string;
  coordinates: { lat: number; lng: number };
  book: {
    id: string;
    title: string;
    author: string;
    coverUrl: string | null;
  };
  isFictional: boolean;
  fictionalWorldName: string | null;
  addedBy: string;
}

export interface AuthorMapLocation {
  id: string;
  name: string;
  type: string;
  coordinates: { lat: number; lng: number };
  author: {
    id: string;
    name: string;
    photoUrl: string | null;
  };
  addedBy: string;
}

/** Coordinates live in Float columns; callers want a `{ lat, lng }` pair. */
function toCoordinates(
  lat: number | null,
  lng: number | null
): { lat: number; lng: number } | null {
  return lat !== null && lng !== null ? { lat, lng } : null;
}

// Get legacy book locations (from book table fields)
export async function getBooksWithLocations(): Promise<BookLocation[]> {
  const books = await prisma.book.findMany({
    where: {
      OR: [{ settingLat: { not: null } }, { authorOriginLat: { not: null } }],
    },
    select: {
      id: true,
      title: true,
      author: true,
      coverUrl: true,
      settingLocation: true,
      settingLat: true,
      settingLng: true,
      authorOrigin: true,
      authorOriginLat: true,
      authorOriginLng: true,
      isFictional: true,
      fictionalWorld: {
        select: {
          name: true,
        },
      },
    },
  });

  return books.map((book) => ({
    id: book.id,
    title: book.title,
    author: book.author,
    coverUrl: book.coverUrl,
    settingLocation: book.settingLocation,
    settingCoordinates: toCoordinates(book.settingLat, book.settingLng),
    authorOrigin: book.authorOrigin,
    authorOriginCoordinates: toCoordinates(
      book.authorOriginLat,
      book.authorOriginLng
    ),
    isFictional: book.isFictional,
    fictionalWorldName: book.fictionalWorld?.name ?? null,
  }));
}

// Get crowdsourced book locations from BookLocation table
export async function getCrowdsourcedBookLocations(): Promise<
  CrowdsourcedLocation[]
> {
  const locations = await prisma.bookLocation.findMany({
    where: {
      isFictional: false,
      lat: { not: null },
      lng: { not: null },
    },
    include: {
      book: {
        select: {
          id: true,
          title: true,
          author: true,
          coverUrl: true,
        },
      },
      fictionalWorld: {
        select: { name: true },
      },
      addedBy: {
        select: { name: true },
      },
    },
  });

  return locations.map((loc) => ({
    id: loc.id,
    name: loc.name,
    type: loc.type,
    // The where clause guarantees both are present.
    coordinates: { lat: loc.lat!, lng: loc.lng! },
    book: loc.book,
    isFictional: loc.isFictional,
    fictionalWorldName: loc.fictionalWorld?.name ?? null,
    addedBy: loc.addedBy.name,
  }));
}

// Get crowdsourced author locations from AuthorLocation table
export async function getCrowdsourcedAuthorLocations(): Promise<
  AuthorMapLocation[]
> {
  const locations = await prisma.authorLocation.findMany({
    include: {
      author: {
        select: {
          id: true,
          name: true,
          photoUrl: true,
        },
      },
      addedBy: {
        select: { name: true },
      },
    },
  });

  return locations.map((loc) => ({
    id: loc.id,
    name: loc.name,
    type: loc.type,
    coordinates: { lat: loc.lat, lng: loc.lng },
    author: loc.author,
    addedBy: loc.addedBy.name,
  }));
}
