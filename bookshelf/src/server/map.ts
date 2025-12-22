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
