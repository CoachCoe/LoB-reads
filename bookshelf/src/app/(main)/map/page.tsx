import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  getBooksWithLocations,
  getCrowdsourcedBookLocations,
  getCrowdsourcedAuthorLocations,
} from "@/server/map";
import { getAllFictionalWorlds } from "@/server/fictional-worlds";
import MapClient from "./MapClient";

export default async function MapPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?callbackUrl=/map");
  }

  const [books, crowdsourcedBooks, crowdsourcedAuthors, fictionalWorlds] = await Promise.all([
    getBooksWithLocations(),
    getCrowdsourcedBookLocations(),
    getCrowdsourcedAuthorLocations(),
    getAllFictionalWorlds(),
  ]);

  return (
    <MapClient
      books={books}
      crowdsourcedBookLocations={crowdsourcedBooks}
      crowdsourcedAuthorLocations={crowdsourcedAuthors}
      initialFictionalWorlds={fictionalWorlds}
    />
  );
}
