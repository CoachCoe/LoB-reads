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
    },
  });

  return books.map((book) => ({
    ...book,
    settingCoordinates: book.settingCoordinates
      ? JSON.parse(book.settingCoordinates)
      : null,
    authorOriginCoordinates: book.authorOriginCoordinates
      ? JSON.parse(book.authorOriginCoordinates)
      : null,
  }));
}
