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

// Get legacy book locations (from book table fields)
export async function getBooksWithLocations(): Promise<BookLocation[]> {
  const books = await prisma.book.findMany({
    where: {
      OR: [
        { settingCoordinates: { not: null } },
        { authorOriginCoordinates: { not: null } },
      ],
    },
    select: {
      id: true,
      title: true,
      author: true,
      coverUrl: true,
      settingLocation: true,
      settingCoordinates: true,
      authorOrigin: true,
      authorOriginCoordinates: true,
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
    settingCoordinates: book.settingCoordinates
      ? JSON.parse(book.settingCoordinates)
      : null,
    authorOrigin: book.authorOrigin,
    authorOriginCoordinates: book.authorOriginCoordinates
      ? JSON.parse(book.authorOriginCoordinates)
      : null,
    isFictional: book.isFictional,
    fictionalWorldName: book.fictionalWorld?.name ?? null,
  }));
}

// Get crowdsourced book locations from BookLocation table
export async function getCrowdsourcedBookLocations(): Promise<CrowdsourcedLocation[]> {
  const locations = await prisma.bookLocation.findMany({
    where: {
      isFictional: false,
      coordinates: { not: null },
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
    coordinates: JSON.parse(loc.coordinates!),
    book: loc.book,
    isFictional: loc.isFictional,
    fictionalWorldName: loc.fictionalWorld?.name ?? null,
    addedBy: loc.addedBy.name,
  }));
}

// Get crowdsourced author locations from AuthorLocation table
export async function getCrowdsourcedAuthorLocations(): Promise<AuthorMapLocation[]> {
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
    coordinates: JSON.parse(loc.coordinates),
    author: loc.author,
    addedBy: loc.addedBy.name,
  }));
}
